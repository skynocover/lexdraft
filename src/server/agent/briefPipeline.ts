import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs, cases, disputes, damages, briefVersions } from '../db/schema';
import { getDB } from '../db';
import { type ClaudeUsage } from './claudeClient';
import { readLawRefs, upsertManyLawRefs } from '../lib/lawRefsJson';
import type { LawRefItem } from '../lib/lawRefsJson';
import { runResearchAgent, type ResearchProgressCallback } from './researchAgent';
import {
  runOrchestratorAgent,
  type OrchestratorOutput,
  type OrchestratorProgressCallback,
} from './orchestratorAgent';
import { parseJsonField, loadReadyFiles, toolError, toolSuccess } from './toolHelpers';
import { ContextStore } from './contextStore';
import type { ToolResult } from './tools/types';
import type { Paragraph } from '../../client/stores/useBriefStore';
import type { AIEnv } from './aiClient';
import type { SSEEvent, PipelineStep, PipelineStepChild } from '../../shared/types';
import { callStrategist } from './pipeline/strategyStep';
import { writeSectionV3, cleanupUncitedLaws, getSectionKey } from './pipeline/writerStep';
import type { FileRow } from './pipeline/writerStep';

// ── Types ──

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

// ── Progress Tracker (4 steps) ──

const STEP_CASE = 0;
const STEP_LAW = 1;
const STEP_STRATEGY = 2;
const STEP_WRITER = 3;

const createProgressTracker = (sendSSE: PipelineContext['sendSSE']) => {
  const steps: PipelineStep[] = [
    { label: '案件確認', status: 'pending' },
    { label: '法條研究', status: 'pending' },
    { label: '論證策略', status: 'pending' },
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
      steps[STEP_WRITER] = {
        ...steps[STEP_WRITER],
        label: `書狀撰寫 ${current}/${total}`,
        detail: sectionLabel,
        status: 'running',
      };
      await send();
    },
    completeWriting: async (total: number) => {
      steps[STEP_WRITER] = {
        ...steps[STEP_WRITER],
        label: '書狀撰寫',
        detail: `${total} 段完成`,
        status: 'done',
      };
      await send();
    },
  };
};

// ── Main Pipeline ──

export const runBriefPipeline = async (ctx: PipelineContext): Promise<ToolResult> => {
  const totalUsage: ClaudeUsage = { input_tokens: 0, output_tokens: 0 };
  const failedSections: string[] = [];
  const store = new ContextStore();

  try {
    const progress = createProgressTracker(ctx.sendSSE);

    // ═══ Step 1: Orchestrator Agent — 案件分析 ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(STEP_CASE);

    let readyFiles;
    try {
      readyFiles = await loadReadyFiles(ctx.db, ctx.caseId);
    } catch (e) {
      return e as ToolResult;
    }

    const [existingDisputes, existingDamages, briefId, caseRow] = await Promise.all([
      ctx.drizzle.select().from(disputes).where(eq(disputes.case_id, ctx.caseId)),
      ctx.drizzle.select().from(damages).where(eq(damages.case_id, ctx.caseId)),
      createBriefInDB(ctx),
      ctx.drizzle
        .select({ plaintiff: cases.plaintiff, defendant: cases.defendant })
        .from(cases)
        .where(eq(cases.id, ctx.caseId))
        .then((rows) => rows[0] || { plaintiff: null, defendant: null }),
    ]);

    // Set up progress children for file reads
    const readChildren: PipelineStepChild[] = [];

    const orchestratorProgress: OrchestratorProgressCallback = {
      onFileReadStart: async (filename) => {
        readChildren.push({ label: `閱讀 ${filename}`, status: 'running' });
        await progress.setStepChildren(STEP_CASE, [...readChildren]);
      },
      onFileReadDone: async (filename) => {
        const idx = readChildren.findIndex(
          (c) => c.label === `閱讀 ${filename}` && c.status === 'running',
        );
        if (idx >= 0) {
          readChildren[idx] = { ...readChildren[idx], status: 'done' };
          await progress.setStepChildren(STEP_CASE, [...readChildren]);
        }
      },
      onAnalysisStart: async () => {
        readChildren.push({ label: '分析案件', status: 'running' });
        await progress.setStepChildren(STEP_CASE, [...readChildren]);
      },
    };

    store.briefType = ctx.briefType;

    // Run Orchestrator Agent with fallback
    let orchestratorOutput: OrchestratorOutput | null = null;
    try {
      orchestratorOutput = await runOrchestratorAgent(
        ctx.aiEnv,
        ctx.drizzle,
        {
          readyFiles: readyFiles.map((f) => {
            const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
            return {
              id: f.id,
              filename: f.filename,
              category: f.category,
              summary: (summary.summary as string) || null,
            };
          }),
          existingParties: { plaintiff: caseRow.plaintiff, defendant: caseRow.defendant },
          briefType: ctx.briefType,
        },
        ctx.signal,
        orchestratorProgress,
      );

      store.seedFromOrchestrator(orchestratorOutput);
    } catch (orchErr) {
      console.error('Orchestrator Agent failed, falling back to analyze_disputes:', orchErr);

      // Fallback: use existing analyze_disputes logic
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
      store.seedFromDisputes(disputeList);
    }

    // Sync disputes to DB if Orchestrator produced issues
    if (orchestratorOutput && orchestratorOutput.legalIssues.length >= existingDisputes.length) {
      // Delete old disputes and insert new ones
      await ctx.drizzle.delete(disputes).where(eq(disputes.case_id, ctx.caseId));
      if (orchestratorOutput.legalIssues.length) {
        await ctx.drizzle.insert(disputes).values(
          orchestratorOutput.legalIssues.map((issue) => ({
            id: issue.id,
            case_id: ctx.caseId,
            number: 0,
            title: issue.title,
            our_position: issue.our_position,
            their_position: issue.their_position,
            evidence: issue.key_evidence.length > 0 ? JSON.stringify(issue.key_evidence) : null,
            law_refs: issue.mentioned_laws.length > 0 ? JSON.stringify(issue.mentioned_laws) : null,
          })),
        );
      }

      // Send SSE updates
      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: '',
        action: 'set_disputes',
        data: orchestratorOutput.legalIssues.map((d, i) => ({
          id: d.id,
          case_id: ctx.caseId,
          number: i + 1,
          title: d.title,
          our_position: d.our_position,
          their_position: d.their_position,
          evidence: d.key_evidence,
          law_refs: d.mentioned_laws,
          facts: d.facts,
        })),
      });

      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: '',
        action: 'set_parties',
        data: orchestratorOutput.parties,
      });
    }

    // Clean up: mark any stale running children as done
    let childrenChanged = false;
    for (let i = 0; i < readChildren.length; i++) {
      if (readChildren[i].status === 'running') {
        readChildren[i] = { ...readChildren[i], status: 'done' };
        childrenChanged = true;
      }
    }
    if (childrenChanged) {
      await progress.setStepChildren(STEP_CASE, [...readChildren]);
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
    const fileContentMap = new Map<string, FileRow>(allFiles.map((f) => [f.id, f]));

    // Load all existing law refs (user-added ones will be passed to Strategist)
    const allLawRefRows = await readLawRefs(ctx.drizzle, ctx.caseId);

    // Build step content
    const criticalGaps = orchestratorOutput
      ? orchestratorOutput.informationGaps
          .filter((g) => g.severity === 'critical')
          .map((g) => ({ description: g.description, suggestion: g.suggestion }))
      : [];

    await progress.completeStep(
      STEP_CASE,
      `${readyFiles.length} 份檔案、${store.legalIssues.length} 個爭點`,
      {
        type: 'case_confirm',
        files: readyFiles.map((f) => f.filename),
        issues: store.legalIssues.map((d) => ({
          id: d.id,
          title: d.title,
        })),
        parties: orchestratorOutput?.parties,
        gaps: criticalGaps.length > 0 ? criticalGaps : undefined,
      },
    );

    // ═══ Step 2: Legal Research Agent ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(STEP_LAW);

    // Build case summary from file summaries for research context
    const caseSummaryForResearch =
      store.caseSummary ||
      readyFiles
        .map((f) => {
          const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
          return `${f.filename}: ${summary.summary || ''}`;
        })
        .join('\n');

    // Track search children for progress UI
    const searchChildren: PipelineStepChild[] = [];

    const researchProgress: ResearchProgressCallback = {
      onSearchStart: async (query) => {
        searchChildren.push({ label: query, status: 'running' });
        await progress.setStepChildren(STEP_LAW, [...searchChildren]);
      },
      onSearchResult: async (query, count, laws) => {
        const idx = searchChildren.findIndex((c) => c.label === query && c.status === 'running');
        if (idx >= 0) {
          searchChildren[idx] = {
            ...searchChildren[idx],
            status: 'done',
            detail: `${count} 條`,
            results: laws,
          };
          await progress.setStepChildren(STEP_LAW, [...searchChildren]);
        }
      },
      onIssueComplete: async () => {
        // Progress is tracked per-search; issue completion is implicit
      },
    };

    const researchResult = await runResearchAgent(
      ctx.aiEnv,
      ctx.mongoUrl,
      {
        legalIssues: store.legalIssues.map((issue) => ({
          id: issue.id,
          title: issue.title,
          our_position: issue.our_position,
          their_position: issue.their_position,
        })),
        caseSummary: caseSummaryForResearch,
        briefType: ctx.briefType,
      },
      ctx.signal,
      researchProgress,
    );

    // Set research results directly in ContextStore
    store.research = researchResult.research;

    // Cache found laws in JSON column
    const allResearchLaws = researchResult.research.flatMap((r) => r.found_laws);
    const seenLawIds = new Set<string>();
    const lawRefsToCache: LawRefItem[] = [];
    for (const law of allResearchLaws) {
      if (seenLawIds.has(law.id)) continue;
      seenLawIds.add(law.id);
      lawRefsToCache.push({
        id: law.id,
        law_name: law.law_name,
        article: law.article_no,
        full_text: law.content,
        is_manual: false,
      });
    }
    if (lawRefsToCache.length) {
      await upsertManyLawRefs(ctx.drizzle, ctx.caseId, lawRefsToCache);
    }

    const totalLawCount = seenLawIds.size;
    await progress.completeStep(
      STEP_LAW,
      `${totalLawCount} 條（${researchResult.totalSearches} 次搜尋）`,
      {
        type: 'research',
        groups: researchResult.research.map((r) => {
          const issue = store.legalIssues.find((i) => i.id === r.issue_id);
          return {
            section: issue?.title || r.issue_id,
            items: r.found_laws.map((l) => ({
              name: `${l.law_name} ${l.article_no}`,
              type: l.side,
            })),
          };
        }),
        totalCount: totalLawCount,
      },
    );

    // ═══ Step 3: 論證策略 ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(STEP_STRATEGY);

    // Identify user-added laws (is_manual = true)
    const userAddedLaws = allLawRefRows
      .filter((r) => r.is_manual && r.full_text)
      .map((r) => ({
        id: r.id,
        law_name: r.law_name,
        article_no: r.article,
        content: r.full_text,
      }));

    const strategyOutput = await callStrategist(
      ctx,
      store,
      readyFiles,
      existingDamages,
      totalUsage,
      userAddedLaws,
    );

    // Set strategy in ContextStore
    store.setStrategyOutput(strategyOutput.claims, strategyOutput.sections);

    // Send claims to frontend via SSE
    await ctx.sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_claims',
      data: strategyOutput.claims,
    });

    const ourClaimCount = strategyOutput.claims.filter((c) => c.side === 'ours').length;
    const theirClaimCount = strategyOutput.claims.filter((c) => c.side === 'theirs').length;
    const rebuttalCount = strategyOutput.claims.filter((c) => c.claim_type === 'rebuttal').length;
    const unrebutted = store.getUnrebutted().length;
    await progress.completeStep(
      STEP_STRATEGY,
      `${strategyOutput.sections.length} 段、${ourClaimCount} 項我方主張、${theirClaimCount} 項對方主張`,
      {
        type: 'strategy',
        sections: strategyOutput.sections.map((s) => ({
          id: s.id,
          section: s.section,
          subsection: s.subsection,
          claimCount: s.claims.length,
        })),
        claimCount: strategyOutput.claims.length,
        rebuttalCount,
        unrebutted,
      },
    );

    // ═══ Step 4: Writer (sequential, uses strategy sections) ═══
    const paragraphs: Paragraph[] = [];

    for (let i = 0; i < store.sections.length; i++) {
      if (ctx.signal.aborted) break;

      const strategySection = store.sections[i];
      const sectionKey = getSectionKey(strategySection.section, strategySection.subsection);

      await progress.updateWriting(i + 1, store.sections.length, sectionKey);

      try {
        const writerCtx = store.getContextForSection(i);

        const paragraph = await writeSectionV3(
          ctx,
          briefId,
          strategySection,
          writerCtx,
          fileContentMap,
          store,
          i,
          totalUsage,
        );

        paragraphs.push(paragraph);

        // Record in ContextStore for subsequent sections' review layer
        store.addDraftSection({
          paragraph_id: paragraph.id,
          section_id: strategySection.id,
          content: paragraph.content_md,
          segments: paragraph.segments || [],
          citations: paragraph.citations,
        });
      } catch (err) {
        console.error(`Writer failed for section "${sectionKey}":`, err);
        failedSections.push(sectionKey);
      }
    }

    await progress.completeWriting(paragraphs.length);

    // ═══ Cleanup: delete uncited non-manual law refs ═══
    await cleanupUncitedLaws(ctx, paragraphs);

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
    if (strategyOutput.claims.length > 0) {
      resultMsg += `\n論證策略：${ourClaimCount} 項我方主張、${theirClaimCount} 項對方主張。`;
    }
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
