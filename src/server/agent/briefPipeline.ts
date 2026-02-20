import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs, cases, disputes, damages, briefVersions } from '../db/schema';
import { getDB } from '../db';
import {
  callClaude,
  callClaudeWithCitations,
  type ClaudeDocument,
  type ClaudeUsage,
} from './claudeClient';
import { searchLaw } from '../lib/lawSearch';
import { hasReplacementChars, buildLawTextMap, repairLawCitations } from '../lib/textSanitize';
import {
  readLawRefs,
  upsertLawRef,
  upsertManyLawRefs,
  hasLawRefByNameArticle,
  removeLawRefsWhere,
} from '../lib/lawRefsJson';
import type { LawRefItem } from '../lib/lawRefsJson';
import { runResearchAgent, type ResearchProgressCallback } from './researchAgent';
import {
  runOrchestratorAgent,
  type OrchestratorOutput,
  type OrchestratorProgressCallback,
} from './orchestratorAgent';
import {
  parseJsonField,
  loadReadyFiles,
  toolError,
  toolSuccess,
  parseLLMJsonResponse,
} from './toolHelpers';
import { PLANNER_SYSTEM_PROMPT } from './prompts/plannerPrompt';
import { STRATEGIST_SYSTEM_PROMPT, buildStrategistInput } from './prompts/strategistPrompt';
import { ContextStore } from './contextStore';
import { validateStrategyOutput, parseStrategyOutput } from './pipeline/validateStrategy';
import type { StrategyOutput, FoundLaw } from './pipeline/types';
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

// ── Progress Tracker (5 steps) ──

const STEP_CASE = 0;
const STEP_LAW = 1;
const STEP_STRATEGY = 2;
const STEP_OUTLINE = 3;
const STEP_WRITER = 4;

const createProgressTracker = (sendSSE: PipelineContext['sendSSE']) => {
  const steps: PipelineStep[] = [
    { label: '案件確認', status: 'pending' },
    { label: '法條研究', status: 'pending' },
    { label: '論證策略', status: 'pending' },
    { label: '書狀大綱', status: 'pending' },
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
      for (const issue of orchestratorOutput.legalIssues) {
        await ctx.drizzle.insert(disputes).values({
          id: issue.id,
          case_id: ctx.caseId,
          number: 0,
          title: issue.title,
          our_position: issue.our_position,
          their_position: issue.their_position,
          evidence: issue.key_evidence.length > 0 ? JSON.stringify(issue.key_evidence) : null,
          law_refs: issue.mentioned_laws.length > 0 ? JSON.stringify(issue.mentioned_laws) : null,
        });
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
    const fileContentMap = new Map(allFiles.map((f) => [f.id, f]));

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

    // ═══ Step 4: Planner Sub-Agent（根據策略結果規劃段落）═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(STEP_OUTLINE);

    const plannerInput = buildPlannerInput(
      readyFiles,
      store.legalIssues,
      existingDamages,
      ctx.briefType,
      store,
    );

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

    await progress.completeStep(STEP_OUTLINE, `${plan.sections.length} 段`);

    // ═══ Step 5: Writer (sequential, uses strategy sections) ═══
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

// ── Step 4 helpers (Planner — now after Research + Strategy) ──

const buildPlannerInput = (
  readyFiles: Awaited<ReturnType<typeof loadReadyFiles>>,
  disputeList: Array<{
    id: string;
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
  store: ContextStore,
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

  // Research results summary
  const researchText = store.research
    .map((r) => {
      const issue = store.legalIssues.find((i) => i.id === r.issue_id);
      const lawList = r.found_laws
        .map((l) => {
          const sideLabel = { attack: '攻', defense_risk: '防', reference: '參' }[l.side] || '參';
          return `    [${sideLabel}] ${l.law_name} ${l.article_no}`;
        })
        .join('\n');
      return `- ${issue?.title || r.issue_id}（強度：${r.strength}）\n${lawList}`;
    })
    .join('\n');

  // Strategy sections summary
  const strategySectionsText = store.sections
    .map((s) => {
      const claimList = s.claims
        .map((claimId) => {
          const c = store.claims.find((cl) => cl.id === claimId);
          if (!c) return `    - （未知主張 ${claimId}）`;
          const sideLabel = c.side === 'ours' ? '我方' : '對方';
          const typeLabel = { primary: '主張', rebuttal: '反駁', supporting: '輔助' }[c.claim_type];
          return `    - ${sideLabel}${typeLabel}：${c.statement}`;
        })
        .join('\n');
      const label = s.subsection ? `${s.section} > ${s.subsection}` : s.section;
      return `- ${label}\n${claimList}`;
    })
    .join('\n');

  return `案件檔案摘要：
${fileSummaries}

爭點：
${disputeText || '（尚未分析）'}

損害賠償：
${damageText}${damageList.length > 0 ? `\n合計：NT$ ${totalDamage.toLocaleString()}` : ''}

法條研究結果：
${researchText || '（無研究結果）'}

論證策略（段落與主張配置）：
${strategySectionsText || '（無策略結果）'}

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

// ── Step 3: 論證策略 helpers ──

const callStrategist = async (
  ctx: PipelineContext,
  store: ContextStore,
  readyFiles: Awaited<ReturnType<typeof loadReadyFiles>>,
  damageList: Array<{
    id: string;
    category: string;
    description: string | null;
    amount: number;
  }>,
  usage: ClaudeUsage,
  userAddedLaws: Array<{ id: string; law_name: string; article_no: string; content: string }>,
): Promise<StrategyOutput> => {
  const fileSummaries = readyFiles.map((f) => {
    const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
    return {
      id: f.id,
      filename: f.filename,
      category: f.category,
      summary: (summary.summary as string) || '無摘要',
    };
  });

  const userMessage = buildStrategistInput({
    caseSummary: store.caseSummary,
    briefType: store.briefType,
    legalIssues: store.legalIssues,
    research: store.research.map((r) => ({
      issue_id: r.issue_id,
      strength: r.strength,
      found_laws: r.found_laws.map((l) => ({
        id: l.id,
        law_name: l.law_name,
        article_no: l.article_no,
        content: l.content,
        side: l.side,
      })),
      analysis: r.analysis,
      attack_points: r.attack_points,
      defense_risks: r.defense_risks,
    })),
    informationGaps: store.informationGaps,
    fileSummaries,
    damages: damageList.map((d) => ({
      category: d.category,
      description: d.description,
      amount: d.amount,
    })),
    userAddedLaws,
  });

  // First attempt
  let strategyOutput: StrategyOutput;
  try {
    strategyOutput = await callStrategyLLM(ctx.aiEnv, userMessage, usage);
  } catch (firstErr) {
    // Retry once on parse failure
    try {
      strategyOutput = await callStrategyLLM(ctx.aiEnv, userMessage, usage);
    } catch {
      throw new Error(
        `論證策略規劃失敗：${firstErr instanceof Error ? firstErr.message : '未知錯誤'}`,
      );
    }
  }

  // Validate structure
  const validation = validateStrategyOutput(strategyOutput, store.legalIssues);

  if (!validation.valid) {
    // Retry with error injection — let LLM fix specific issues
    try {
      const retryMessage =
        userMessage +
        `\n\n═══ 修正指示 ═══\n你上一次的輸出有以下結構問題，請修正後重新輸出完整 JSON：\n` +
        validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n');

      strategyOutput = await callStrategyLLM(ctx.aiEnv, retryMessage, usage);

      // Validate again — if still fails, use as-is
      const retryValidation = validateStrategyOutput(strategyOutput, store.legalIssues);
      if (!retryValidation.valid) {
        console.error('Strategy validation still failing after retry:', retryValidation.errors);
      }
    } catch (retryErr) {
      console.error('Strategy retry failed:', retryErr);
      // Use the first (imperfect) output rather than failing completely
    }
  }

  return strategyOutput;
};

const callStrategyLLM = async (
  aiEnv: AIEnv,
  userMessage: string,
  usage: ClaudeUsage,
): Promise<StrategyOutput> => {
  const { content, usage: callUsage } = await callClaude(
    aiEnv,
    STRATEGIST_SYSTEM_PROMPT,
    userMessage,
    8192, // Strategist output includes claims + sections — needs more tokens
  );
  usage.input_tokens += callUsage.input_tokens;
  usage.output_tokens += callUsage.output_tokens;

  return parseStrategyOutput(content);
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

// ── Step 5: Writer (v3 — uses ContextStore) ──

type FileRow = {
  id: string;
  filename: string;
  full_text: string | null;
  content_md: string | null;
};
const writeSectionV3 = async (
  ctx: PipelineContext,
  briefId: string,
  strategySection: StrategyOutput['sections'][number],
  writerCtx: ReturnType<ContextStore['getContextForSection']>,
  fileContentMap: Map<string, FileRow>,
  store: ContextStore,
  sectionIndex: number,
  usage: ClaudeUsage,
): Promise<Paragraph> => {
  const documents: ClaudeDocument[] = [];

  // ── Focus layer: relevant files ──
  for (const fileId of writerCtx.fileIds) {
    const file = fileContentMap.get(fileId);
    if (file) {
      const content = (file.content_md || file.full_text || '').slice(0, 20000);
      if (content) {
        documents.push({ title: file.filename, content, file_id: file.id, doc_type: 'file' });
      }
    }
  }

  // ── Focus layer: laws from strategy (only this section's relevant laws) ──
  for (const law of writerCtx.laws) {
    documents.push({
      title: `${law.law_name} ${law.article_no}`,
      content: law.content,
      doc_type: 'law',
    });
  }

  // Also add laws from sectionLawMap that aren't in strategy (backward compat)
  const strategyLawIds = new Set(writerCtx.laws.map((l) => l.id));
  const allFoundLaws = store.getAllFoundLaws();
  for (const law of allFoundLaws) {
    if (!strategyLawIds.has(law.id) && strategySection.relevant_law_ids.includes(law.id)) {
      documents.push({
        title: `${law.law_name} ${law.article_no}`,
        content: law.content,
        doc_type: 'law',
      });
    }
  }

  // ── Build Writer instruction with 3-layer context ──
  const dispute = strategySection.dispute_id
    ? store.legalIssues.find((d) => d.id === strategySection.dispute_id)
    : null;

  // Background layer: full outline with position marker
  const outlineText = writerCtx.fullOutline
    .map((o) => {
      const label = o.subsection ? `${o.section} > ${o.subsection}` : o.section;
      return o.isCurrent ? `  【你正在寫這段】${label}` : `  ${label}`;
    })
    .join('\n');

  // Focus layer: claims for this section (with attack/defense context)
  const typeLabels: Record<string, string> = {
    primary: '主要主張',
    rebuttal: '反駁',
    supporting: '輔助',
  };
  const claimsText =
    writerCtx.claims.length > 0
      ? writerCtx.claims
          .map((c) => {
            const sideLabel = c.side === 'ours' ? '我方' : '對方';
            const typeLabel = typeLabels[c.claim_type] || '主要主張';
            let line = `  ${c.id}: ${c.statement}（${sideLabel}｜${typeLabel}）`;
            if (c.responds_to) {
              const target = store.claims.find((t) => t.id === c.responds_to);
              if (target) line += `\n    → 回應：${target.id}「${target.statement.slice(0, 50)}」`;
            }
            return line;
          })
          .join('\n')
      : '（無特定主張）';

  // Focus layer: argumentation framework
  const argText = writerCtx.argumentation;
  const legalBasisText =
    argText.legal_basis.length > 0
      ? `法律依據：${argText.legal_basis.join('、')}`
      : '法律依據：（無）';

  // Focus layer: facts to use
  const factsText =
    writerCtx.factsToUse && writerCtx.factsToUse.length > 0
      ? writerCtx.factsToUse
          .map((f) => `  - ${f.fact_id}（${f.assertion_type}）：${f.usage}`)
          .join('\n')
      : '';

  // Review layer: completed sections full text
  const completedText =
    writerCtx.completedSections.length > 0
      ? writerCtx.completedSections
          .map((d) => {
            const sec = store.sections.find((s) => s.id === d.section_id);
            const label = sec ? getSectionKey(sec.section, sec.subsection) : d.section_id;
            return `【${label}】\n${d.content}`;
          })
          .join('\n\n')
      : '';

  let instruction = `你是台灣資深訴訟律師。請根據提供的論證結構和來源文件，撰寫法律書狀段落。

[書狀全局資訊]
  書狀類型：${writerCtx.briefType}
  完整大綱：
${outlineText}

[本段負責的 Claims]
${claimsText}

[本段論證結構]
  ${legalBasisText}
  事實適用：${argText.fact_application}
  結論：${argText.conclusion}`;

  if (factsText) {
    instruction += `

[事實運用]
${factsText}`;
  }

  if (dispute) {
    instruction += `

[爭點資訊]
  爭點：${dispute.title}
  我方立場：${dispute.our_position}
  對方立場：${dispute.their_position}`;
  }

  if (completedText) {
    instruction += `

[已完成段落]（維持前後文一致性）
${completedText}`;
  }

  instruction += `

[撰寫規則]
- 使用正式法律文書用語（繁體中文）
- 依照論證結構和 claims 列表撰寫，確保每個 claim 都有論述
- 引用法條時，務必從提供的法條文件中引用，讓系統能自動標記引用來源
- 引用事實時，從提供的來源文件中引用
- 對「承認」的事實，可使用「此為兩造所不爭執」等用語
- 對「爭執」的事實，需提出證據佐證
- 對「自認」的事實，使用「被告於答辯狀自承」等用語
- 對 rebuttal claim（反駁），需明確引用並反駁對方主張
- 對 supporting claim（輔助），需與同段落的主要主張呼應
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 直接撰寫段落內容，不需要加入章節標題
- 段落長度控制在 150-400 字之間`;

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
    strategySection.section,
    strategySection.subsection,
  );

  // Post-processing: detect uncited law mentions and cache them in JSON
  await postProcessLawCitations(ctx, text, citations);

  // Repair corrupted quoted_text in law citations using JSON data
  const currentRefs = await readLawRefs(ctx.drizzle, ctx.caseId);
  const lawTextMap = buildLawTextMap(currentRefs);
  const allCitationRefs = [...citations, ...segments.flatMap((s) => s.citations)];
  repairLawCitations(allCitationRefs, lawTextMap);

  // Build paragraph
  const paragraph: Paragraph = {
    id: nanoid(),
    section: strategySection.section,
    subsection: strategySection.subsection || '',
    content_md: text,
    segments,
    dispute_id: strategySection.dispute_id || null,
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

// ── Post-processing: law citation tracking ──

const postProcessLawCitations = async (
  ctx: PipelineContext,
  text: string,
  citations: Citation[],
) => {
  const citedLawLabels = new Set(citations.filter((c) => c.type === 'law').map((c) => c.label));

  // Detect law mentions in text that aren't already cached — cache them
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

  const currentRefs = await readLawRefs(ctx.drizzle, ctx.caseId);

  for (const law of uncitedLaws) {
    try {
      const alreadyCached = hasLawRefByNameArticle(currentRefs, law.lawName, law.article);

      if (!alreadyCached && ctx.mongoUrl) {
        const results = await searchLaw(ctx.mongoUrl, {
          query: `${law.lawName} ${law.article}`,
          limit: 1,
        });
        if (results.length > 0) {
          const r = results[0];
          if (hasReplacementChars(r.content)) {
            console.warn(`Skipping corrupted law text from MongoDB: ${r._id}`);
            continue;
          }
          await upsertLawRef(ctx.drizzle, ctx.caseId, {
            id: r._id,
            law_name: r.law_name,
            article: r.article_no,
            full_text: r.content,
            is_manual: false,
          });
        }
      }
    } catch {
      /* skip */
    }
  }

  // Send all law refs to frontend
  const allRefs = await readLawRefs(ctx.drizzle, ctx.caseId);

  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_law_refs',
    data: allRefs,
  });
};

// ── Cleanup: remove uncited non-manual law refs after pipeline ──

const cleanupUncitedLaws = async (ctx: PipelineContext, paragraphs: Paragraph[]) => {
  // Collect all cited law labels from the written paragraphs
  const citedLabels = new Set<string>();
  for (const p of paragraphs) {
    for (const c of p.citations) {
      if (c.type === 'law') citedLabels.add(c.label);
    }
    if (p.segments) {
      for (const seg of p.segments) {
        for (const c of seg.citations) {
          if (c.type === 'law') citedLabels.add(c.label);
        }
      }
    }
  }

  // Remove non-manual law refs that aren't cited
  const beforeRefs = await readLawRefs(ctx.drizzle, ctx.caseId);
  const hasUncited = beforeRefs.some((ref) => {
    if (ref.is_manual) return false;
    const label = `${ref.law_name} ${ref.article}`;
    return !citedLabels.has(label);
  });

  if (hasUncited) {
    const remaining = await removeLawRefsWhere(ctx.drizzle, ctx.caseId, (ref) => {
      if (ref.is_manual) return false;
      const label = `${ref.law_name} ${ref.article}`;
      return !citedLabels.has(label);
    });

    await ctx.sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_law_refs',
      data: remaining,
    });
  }
};
