import { eq, and, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs, disputes, damages, lawRefs, briefVersions } from '../db/schema';
import { getDB } from '../db';
import {
  callClaude,
  callClaudeWithCitations,
  type ClaudeDocument,
  type ClaudeUsage,
} from './claudeClient';
import { searchLaw, searchLawBatch } from '../lib/lawSearch';
import { parseJsonField, loadReadyFiles, toolError, toolSuccess } from './toolHelpers';
import { PLANNER_SYSTEM_PROMPT } from './prompts/plannerPrompt';
import type { ToolResult } from './tools/types';
import type { Paragraph, TextSegment, Citation } from '../../client/stores/useBriefStore';
import type { AIEnv } from './aiClient';
import type { SSEEvent, PipelineStep, PipelineStepChild } from '../../shared/types';

// ── Types ──

interface SectionPlan {
  section: string;
  subsection?: string;
  dispute_id?: string;
  instruction: string;
  relevant_file_ids: string[];
  search_queries: string[];
}

interface BriefPlan {
  sections: SectionPlan[];
}

interface LawResult {
  id: string;
  law_name: string;
  article_no: string;
  content: string;
}

export interface PipelineContext {
  caseId: string;
  briefType: string;
  title: string;
  signal: AbortSignal;
  sendSSE: (event: SSEEvent) => Promise<void>;
  db: D1Database;
  drizzle: ReturnType<typeof getDB>;
  aiEnv: AIEnv;
  mongoUrl: string;
}

const LAW_ARTICLE_REGEX = /([\u4e00-\u9fff]{2,}(?:法|規則|條例|辦法|細則))第(\d+條(?:之\d+)?)/g;

// ── Helpers ──

const getSectionKey = (section: string, subsection?: string) =>
  `${section}${subsection ? ' > ' + subsection : ''}`;

// ── Progress Tracker ──

const createProgressTracker = (sendSSE: PipelineContext['sendSSE']) => {
  const steps: PipelineStep[] = [
    { label: '案件確認', status: 'pending' },
    { label: '書狀大綱', status: 'pending' },
    { label: '法條研究', status: 'pending' },
    { label: '書狀撰寫', status: 'pending' },
  ];

  const send = () => sendSSE({ type: 'pipeline_progress', steps: structuredClone(steps) });

  return {
    startStep: async (index: number) => {
      steps[index].status = 'running';
      await send();
    },
    completeStep: async (index: number, detail?: string, content?: Record<string, unknown>) => {
      steps[index].status = 'done';
      if (detail) steps[index].detail = detail;
      if (content) steps[index].content = content;
      await send();
    },
    setStepChildren: async (index: number, children: PipelineStepChild[]) => {
      steps[index].children = children;
      await send();
    },
    updateStepChild: async (
      stepIndex: number,
      childIndex: number,
      update: Partial<PipelineStepChild>,
    ) => {
      const children = steps[stepIndex].children;
      if (children && children[childIndex]) {
        Object.assign(children[childIndex], update);
        await send();
      }
    },
    setStepContent: async (index: number, content: Record<string, unknown>) => {
      steps[index].content = content;
      await send();
    },
    updateWriting: async (current: number, total: number, sectionLabel: string) => {
      steps[3] = {
        ...steps[3],
        label: `書狀撰寫 ${current}/${total}`,
        detail: sectionLabel,
        status: 'running',
      };
      await send();
    },
    completeWriting: async (total: number) => {
      steps[3] = { ...steps[3], label: '書狀撰寫', detail: `${total} 段完成`, status: 'done' };
      await send();
    },
  };
};

// ── Main Pipeline ──

export const runBriefPipeline = async (ctx: PipelineContext): Promise<ToolResult> => {
  const totalUsage: ClaudeUsage = { input_tokens: 0, output_tokens: 0 };
  const failedSections: string[] = [];

  try {
    const progress = createProgressTracker(ctx.sendSSE);

    // ═══ Step 1: Load data + Create brief ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(0);

    let readyFiles;
    try {
      readyFiles = await loadReadyFiles(ctx.db, ctx.caseId);
    } catch (e) {
      return e as ToolResult;
    }

    const [existingDisputes, existingDamages, briefId] = await Promise.all([
      ctx.drizzle.select().from(disputes).where(eq(disputes.case_id, ctx.caseId)),
      ctx.drizzle.select().from(damages).where(eq(damages.case_id, ctx.caseId)),
      createBriefInDB(ctx),
    ]);

    // Analyze disputes if none exist (internal Gemini call)
    let disputeList = existingDisputes;
    if (!disputeList.length) {
      const { handleAnalyzeDisputes } = await import('./tools/analyzeDisputes');
      const result = await handleAnalyzeDisputes({}, ctx.caseId, ctx.db, ctx.drizzle, {
        sendSSE: ctx.sendSSE,
        aiEnv: ctx.aiEnv,
        mongoUrl: ctx.mongoUrl,
      });
      if (result.success) {
        disputeList = await ctx.drizzle
          .select()
          .from(disputes)
          .where(eq(disputes.case_id, ctx.caseId));
      }
    }

    // Load file contents for Writers
    const allFiles = await ctx.drizzle
      .select({
        id: files.id,
        filename: files.filename,
        full_text: files.full_text,
        content_md: files.content_md,
      })
      .from(files)
      .where(eq(files.case_id, ctx.caseId));
    const fileContentMap = new Map(allFiles.map((f) => [f.id, f]));

    // Load manual law refs (included in every Writer call)
    const manualLawRows = await ctx.drizzle
      .select()
      .from(lawRefs)
      .where(and(eq(lawRefs.case_id, ctx.caseId), eq(lawRefs.source, 'manual')));

    await progress.completeStep(0, `${readyFiles.length} 份檔案、${disputeList.length} 個爭點`, {
      type: 'case_confirm',
      files: readyFiles.map((f) => f.filename),
      issues: disputeList.map((d) => ({
        id: d.id,
        title: d.title || '未命名爭點',
      })),
    });

    // ═══ Step 2: Planner Sub-Agent ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(1);

    const plannerInput = buildPlannerInput(readyFiles, disputeList, existingDamages, ctx.briefType);

    let plan: BriefPlan;
    try {
      plan = await callPlanner(ctx.aiEnv, plannerInput, totalUsage);
    } catch (firstErr) {
      // Retry once
      try {
        plan = await callPlanner(ctx.aiEnv, plannerInput, totalUsage);
      } catch {
        return toolError(
          `書狀結構規劃失敗：${firstErr instanceof Error ? firstErr.message : '未知錯誤'}`,
        );
      }
    }

    if (!plan.sections.length) {
      return toolError('Planner 未產出任何段落計畫');
    }

    await progress.completeStep(1, `${plan.sections.length} 段`);

    // ═══ Step 3: Law search (parallel) ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(2);

    const sectionLawMap = await searchLawsForPlan(
      plan,
      ctx.mongoUrl,
      ctx.caseId,
      ctx.drizzle,
      progress,
    );

    const totalLawCount = new Set(
      Array.from(sectionLawMap.values())
        .flat()
        .map((l) => l.id),
    ).size;
    await progress.completeStep(2, `${totalLawCount} 條`, {
      type: 'research',
      groups: Array.from(sectionLawMap.entries()).map(([sectionKey, laws]) => ({
        section: sectionKey,
        items: laws.map((l) => ({
          name: `${l.law_name} ${l.article_no}`,
          type: 'law',
        })),
      })),
      totalCount: totalLawCount,
    });

    // ═══ Step 4: Writer (sequential) ═══
    const paragraphs: Paragraph[] = [];
    let previousSectionText = '';

    for (let i = 0; i < plan.sections.length; i++) {
      if (ctx.signal.aborted) break;

      const sectionPlan = plan.sections[i];
      const sectionKey = getSectionKey(sectionPlan.section, sectionPlan.subsection);

      await progress.updateWriting(i + 1, plan.sections.length, sectionKey);

      try {
        const paragraph = await writeSection(
          ctx,
          briefId,
          sectionPlan,
          fileContentMap,
          manualLawRows,
          sectionLawMap.get(sectionKey) || [],
          disputeList,
          previousSectionText,
          paragraphs,
          totalUsage,
        );

        paragraphs.push(paragraph);
        previousSectionText = paragraph.content_md;

        // (no draft preview content — step 3 is not expandable)
      } catch (err) {
        console.error(`Writer failed for section "${sectionKey}":`, err);
        failedSections.push(sectionKey);
      }
    }

    await progress.completeWriting(paragraphs.length);

    // Save version snapshot (one version for entire pipeline)
    const finalBrief = await ctx.drizzle.select().from(briefs).where(eq(briefs.id, briefId));
    if (finalBrief.length) {
      const versionCount = await ctx.drizzle
        .select()
        .from(briefVersions)
        .where(eq(briefVersions.brief_id, briefId));
      await ctx.drizzle.insert(briefVersions).values({
        id: nanoid(),
        brief_id: briefId,
        version_no: versionCount.length + 1,
        label: `AI 撰寫完成（${paragraphs.length} 段）`,
        content_structured: finalBrief[0].content_structured || JSON.stringify({ paragraphs: [] }),
        created_at: new Date().toISOString(),
        created_by: 'ai',
      });
    }

    // Report Claude usage
    await ctx.sendSSE({
      type: 'usage',
      prompt_tokens: totalUsage.input_tokens,
      completion_tokens: totalUsage.output_tokens,
      total_tokens: totalUsage.input_tokens + totalUsage.output_tokens,
      estimated_cost_ntd:
        Math.round(
          ((totalUsage.input_tokens * 0.8 + totalUsage.output_tokens * 4.0) / 1_000_000) *
            32 *
            10000,
        ) / 10000,
    });

    let resultMsg = `已完成書狀撰寫，共 ${paragraphs.length} 個段落。`;
    if (failedSections.length) {
      resultMsg += `\n以下段落撰寫失敗：${failedSections.join('、')}`;
    }
    if (ctx.signal.aborted) {
      resultMsg += `\n（已取消，保留已完成的 ${paragraphs.length} 個段落）`;
    }

    return toolSuccess(resultMsg);
  } catch (err) {
    return toolError(`Pipeline 執行失敗：${err instanceof Error ? err.message : '未知錯誤'}`);
  }
};

// ── Step 1 helpers ──

const createBriefInDB = async (ctx: PipelineContext): Promise<string> => {
  const briefId = nanoid();
  const now = new Date().toISOString();

  await ctx.drizzle.insert(briefs).values({
    id: briefId,
    case_id: ctx.caseId,
    brief_type: ctx.briefType,
    title: ctx.title,
    content_structured: JSON.stringify({ paragraphs: [] }),
    version: 1,
    created_at: now,
    updated_at: now,
  });

  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: briefId,
    action: 'create_brief',
    data: {
      id: briefId,
      case_id: ctx.caseId,
      brief_type: ctx.briefType,
      title: ctx.title,
      content_structured: { paragraphs: [] },
      version: 1,
      created_at: now,
      updated_at: now,
    },
  });

  return briefId;
};

// ── Step 2 helpers ──

const buildPlannerInput = (
  readyFiles: Awaited<ReturnType<typeof loadReadyFiles>>,
  disputeList: Array<{
    id: string;
    number: number | null;
    title: string | null;
    our_position: string | null;
    their_position: string | null;
  }>,
  damageList: Array<{
    id: string;
    category: string;
    description: string | null;
    amount: number;
  }>,
  briefType: string,
): string => {
  const fileSummaries = readyFiles
    .map((f) => {
      const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
      return `- [${f.id}] ${f.filename} (${f.category}): ${summary.summary || '無摘要'}`;
    })
    .join('\n');

  const disputeText = disputeList
    .map((d) => `- [${d.id}] ${d.title}\n  我方：${d.our_position}\n  對方：${d.their_position}`)
    .join('\n');

  const damageText =
    damageList.length > 0
      ? damageList
          .map((d) => `- ${d.category}: NT$ ${d.amount.toLocaleString()} (${d.description || ''})`)
          .join('\n')
      : '無';

  const totalDamage = damageList.reduce((sum, d) => sum + d.amount, 0);

  return `案件檔案摘要：
${fileSummaries}

爭點：
${disputeText || '（尚未分析）'}

損害賠償：
${damageText}${damageList.length > 0 ? `\n合計：NT$ ${totalDamage.toLocaleString()}` : ''}

書狀類型：${briefType}`;
};

const callPlanner = async (aiEnv: AIEnv, input: string, usage: ClaudeUsage): Promise<BriefPlan> => {
  const { content, usage: callUsage } = await callClaude(aiEnv, PLANNER_SYSTEM_PROMPT, input);
  usage.input_tokens += callUsage.input_tokens;
  usage.output_tokens += callUsage.output_tokens;

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Planner 回傳格式不正確（無法找到 JSON）');
  }

  const plan = JSON.parse(jsonMatch[0]) as BriefPlan;
  if (!plan.sections || !Array.isArray(plan.sections)) {
    throw new Error('Planner 回傳格式不正確（缺少 sections 陣列）');
  }

  return plan;
};

// ── Step 3 helpers ──

const searchLawsForPlan = async (
  plan: BriefPlan,
  mongoUrl: string,
  caseId: string,
  drizzle: ReturnType<typeof getDB>,
  progress?: ReturnType<typeof createProgressTracker>,
): Promise<Map<string, LawResult[]>> => {
  const queryToSections = new Map<string, string[]>();

  for (const section of plan.sections) {
    const sectionKey = getSectionKey(section.section, section.subsection);
    for (const query of section.search_queries || []) {
      const existing = queryToSections.get(query) || [];
      existing.push(sectionKey);
      queryToSections.set(query, existing);
    }
  }

  const queries = Array.from(queryToSections.keys());

  // Set up children for law search step
  if (progress && queries.length > 0) {
    const children: PipelineStepChild[] = queries.map((q) => ({
      label: q,
      status: 'pending' as const,
    }));
    await progress.setStepChildren(2, children);
  }

  // Mark all as running
  if (progress) {
    for (let i = 0; i < queries.length; i++) {
      await progress.updateStepChild(2, i, { status: 'running' });
    }
  }

  // Use searchLawBatch for single MongoClient connection
  const batchResults = await searchLawBatch(
    mongoUrl,
    queries.map((q) => ({ query: q, limit: 5 })),
  );

  // Update progress for each query result
  const results: { query: string; laws: Awaited<ReturnType<typeof searchLaw>> }[] = [];
  for (let idx = 0; idx < queries.length; idx++) {
    const query = queries[idx];
    const laws = batchResults.get(query) || [];
    if (progress) {
      await progress.updateStepChild(2, idx, {
        status: 'done',
        detail: `${laws.length} 條`,
        results: laws.map((l) => `${l.law_name} ${l.article_no}`),
      });
    }
    results.push({ query, laws });
  }

  // Cache in D1
  for (const { laws } of results) {
    for (const law of laws) {
      try {
        await drizzle
          .insert(lawRefs)
          .values({
            id: law._id,
            case_id: caseId,
            law_name: law.law_name,
            article: law.article_no,
            title: `${law.law_name} ${law.article_no}`,
            full_text: law.content,
            usage_count: 1,
            source: 'search',
          })
          .onConflictDoUpdate({
            target: lawRefs.id,
            set: { usage_count: sql`coalesce(${lawRefs.usage_count}, 0) + 1` },
          });
      } catch {
        /* skip */
      }
    }
  }

  // Map back to sections
  const sectionLawMap = new Map<string, LawResult[]>();

  for (const { query, laws } of results) {
    const sectionKeys = queryToSections.get(query) || [];
    const lawResults: LawResult[] = laws.map((l) => ({
      id: l._id,
      law_name: l.law_name,
      article_no: l.article_no,
      content: l.content,
    }));

    for (const sectionKey of sectionKeys) {
      const existing = sectionLawMap.get(sectionKey) || [];
      for (const law of lawResults) {
        if (!existing.some((e) => e.id === law.id)) {
          existing.push(law);
        }
      }
      sectionLawMap.set(sectionKey, existing);
    }
  }

  return sectionLawMap;
};

// ── Heading deduplication helper ──

const stripLeadingHeadings = (
  text: string,
  segments: TextSegment[],
  citations: Citation[],
  section: string,
  subsection?: string,
): {
  text: string;
  segments: TextSegment[];
  citations: Citation[];
} => {
  // Build patterns to match: section/subsection headings possibly prefixed with # marks
  const headings = [section];
  if (subsection) headings.push(subsection);

  let stripped = text;
  let totalCharsRemoved = 0;

  // Strip leading lines that match headings
  for (const heading of headings) {
    // Match: optional leading whitespace, optional `#`+ prefix, optional whitespace, then heading text, then newline
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*#{0,6}\\s*${escaped}\\s*\\n?`);
    const match = stripped.match(pattern);
    if (match) {
      totalCharsRemoved += match[0].length;
      stripped = stripped.slice(match[0].length);
    }
  }

  // Also strip any remaining leading blank lines after heading removal
  const leadingBlanks = stripped.match(/^(\s*\n)+/);
  if (leadingBlanks) {
    totalCharsRemoved += leadingBlanks[0].length;
    stripped = stripped.slice(leadingBlanks[0].length);
  }

  if (totalCharsRemoved === 0) {
    return { text, segments, citations };
  }

  // Adjust segments: walk through and trim/drop by character count
  let charsToSkip = totalCharsRemoved;
  const newSegments: TextSegment[] = [];

  for (const seg of segments) {
    if (charsToSkip <= 0) {
      newSegments.push(seg);
      continue;
    }

    if (charsToSkip >= seg.text.length) {
      // Entire segment is in the stripped region — drop it
      charsToSkip -= seg.text.length;
      continue;
    }

    // Partial overlap — trim the beginning of this segment
    newSegments.push({
      text: seg.text.slice(charsToSkip),
      citations: seg.citations,
    });
    charsToSkip = 0;
  }

  // Collect remaining citation IDs from surviving segments
  const remainingCitationIds = new Set<string>();
  for (const seg of newSegments) {
    for (const c of seg.citations) {
      remainingCitationIds.add(c.id);
    }
  }

  const newCitations = citations.filter((c) => remainingCitationIds.has(c.id));

  return { text: stripped, segments: newSegments, citations: newCitations };
};

// ── Step 4 helpers ──

type FileRow = {
  id: string;
  filename: string;
  full_text: string | null;
  content_md: string | null;
};
type ManualLawRow = {
  id: string;
  law_name: string | null;
  article: string | null;
  full_text: string | null;
};
type DisputeRow = {
  id: string;
  title: string | null;
  our_position: string | null;
  their_position: string | null;
};

const writeSection = async (
  ctx: PipelineContext,
  briefId: string,
  plan: SectionPlan,
  fileContentMap: Map<string, FileRow>,
  manualLawRows: ManualLawRow[],
  laws: LawResult[],
  disputeList: DisputeRow[],
  previousSectionText: string,
  existingParagraphs: Paragraph[],
  usage: ClaudeUsage,
): Promise<Paragraph> => {
  const documents: ClaudeDocument[] = [];

  // Add relevant files as documents
  for (const fileId of plan.relevant_file_ids) {
    const file = fileContentMap.get(fileId);
    if (file) {
      const content = (file.content_md || file.full_text || '').slice(0, 20000);
      if (content) {
        documents.push({ title: file.filename, content, file_id: file.id, doc_type: 'file' });
      }
    }
  }

  // Add manual law refs
  for (const ref of manualLawRows) {
    if (ref.full_text) {
      documents.push({
        title: `${ref.law_name} ${ref.article}`,
        content: ref.full_text,
        doc_type: 'law',
      });
    }
  }

  // Add searched laws
  for (const law of laws) {
    documents.push({
      title: `${law.law_name} ${law.article_no}`,
      content: law.content,
      doc_type: 'law',
    });
  }

  // Build Writer instruction
  const dispute = plan.dispute_id ? disputeList.find((d) => d.id === plan.dispute_id) : null;

  let instruction = `你是一位專業的台灣律師助理。請根據提供的來源文件和法條，撰寫法律書狀的一個段落。

撰寫要求：
- 章節：${plan.section}
- 子章節：${plan.subsection || '（無）'}
- 指示：${plan.instruction}`;

  if (dispute) {
    instruction += `

爭點資訊：
- 爭點：${dispute.title}
- 我方立場：${dispute.our_position}
- 對方立場：${dispute.their_position}`;
  }

  if (previousSectionText) {
    instruction += `

前段內容（確保論證連貫）：
---
${previousSectionText}
---`;
  }

  instruction += `

撰寫規則：
- 使用正式法律文書用語（繁體中文）
- 論述要有邏輯、條理分明
- 引用法條時，務必從提供的法條文件中引用，讓系統能自動標記引用來源
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 直接撰寫段落內容，不需要加入章節標題
- 段落長度控制在 150-300 字之間，簡潔有力`;

  // Call Claude Citations API
  const {
    text: rawText,
    segments: rawSegments,
    citations: rawCitations,
    usage: callUsage,
  } = await callClaudeWithCitations(ctx.aiEnv, documents, instruction);

  usage.input_tokens += callUsage.input_tokens;
  usage.output_tokens += callUsage.output_tokens;

  // Strip duplicate headings that Claude may have included
  const { text, segments, citations } = stripLeadingHeadings(
    rawText,
    rawSegments,
    rawCitations,
    plan.section,
    plan.subsection,
  );

  // Post-processing: mark cited laws, detect uncited mentions
  const citedLawLabels = new Set(citations.filter((c) => c.type === 'law').map((c) => c.label));

  // Mark searched laws that were cited
  for (const law of laws) {
    if (citedLawLabels.has(`${law.law_name} ${law.article_no}`)) {
      await ctx.drizzle.update(lawRefs).set({ source: 'cited' }).where(eq(lawRefs.id, law.id));
    }
  }

  // Mark manual laws that were cited
  for (const ref of manualLawRows) {
    if (citedLawLabels.has(`${ref.law_name} ${ref.article}`)) {
      await ctx.drizzle.update(lawRefs).set({ source: 'cited' }).where(eq(lawRefs.id, ref.id));
    }
  }

  // Detect uncited law mentions in text
  const mentionedLawKeys = new Set<string>();
  for (const match of text.matchAll(LAW_ARTICLE_REGEX)) {
    mentionedLawKeys.add(`${match[1]}|第${match[2]}`);
  }

  const uncitedLaws = Array.from(mentionedLawKeys)
    .map((key) => {
      const [lawName, article] = key.split('|');
      return { lawName, article };
    })
    .filter((m) => !citedLawLabels.has(`${m.lawName} ${m.article}`));

  for (const law of uncitedLaws) {
    try {
      // Check DB first (likely already inserted by Step 3 search)
      const existing = await ctx.drizzle
        .select({ id: lawRefs.id })
        .from(lawRefs)
        .where(
          and(
            eq(lawRefs.case_id, ctx.caseId),
            eq(lawRefs.law_name, law.lawName),
            eq(lawRefs.article, law.article),
          ),
        );

      if (existing.length > 0) {
        // Already in DB — just mark as cited
        await ctx.drizzle
          .update(lawRefs)
          .set({ source: 'cited' })
          .where(eq(lawRefs.id, existing[0].id));
      } else if (ctx.mongoUrl) {
        // Not in DB — search MongoDB
        const results = await searchLaw(ctx.mongoUrl, {
          query: `${law.lawName} ${law.article}`,
          limit: 1,
        });
        if (results.length > 0) {
          const r = results[0];
          await ctx.drizzle
            .insert(lawRefs)
            .values({
              id: r._id,
              case_id: ctx.caseId,
              law_name: r.law_name,
              article: r.article_no,
              title: `${r.law_name} ${r.article_no}`,
              full_text: r.content,
              usage_count: 1,
              source: 'cited',
            })
            .onConflictDoUpdate({
              target: lawRefs.id,
              set: {
                source: 'cited',
                usage_count: sql`coalesce(${lawRefs.usage_count}, 0) + 1`,
              },
            });
        }
      }
    } catch {
      /* skip */
    }
  }

  // Send law refs update
  const displayRefs = await ctx.drizzle
    .select()
    .from(lawRefs)
    .where(and(eq(lawRefs.case_id, ctx.caseId), inArray(lawRefs.source, ['manual', 'cited'])));

  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_law_refs',
    data: displayRefs,
  });

  // Build paragraph
  const paragraph: Paragraph = {
    id: nanoid(),
    section: plan.section,
    subsection: plan.subsection || '',
    content_md: text,
    segments,
    dispute_id: plan.dispute_id || null,
    citations,
  };

  // Update brief in DB
  const briefRows = await ctx.drizzle.select().from(briefs).where(eq(briefs.id, briefId));
  const contentStructured = parseJsonField<{ paragraphs: Paragraph[] }>(
    briefRows[0]?.content_structured,
    { paragraphs: [] },
  );
  contentStructured.paragraphs.push(paragraph);

  await ctx.drizzle
    .update(briefs)
    .set({
      content_structured: JSON.stringify(contentStructured),
      updated_at: new Date().toISOString(),
    })
    .where(eq(briefs.id, briefId));

  // Send paragraph SSE
  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: briefId,
    action: 'add_paragraph',
    data: paragraph,
  });

  return paragraph;
};
