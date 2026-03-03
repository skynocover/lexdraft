import { eq, count } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { briefs, briefVersions, claims } from '../db/schema';
import { upsertManyLawRefs } from '../lib/lawRefsJson';
import type { LawRefItem } from '../lib/lawRefsJson';
import { toolError, toolSuccess } from './toolHelpers';
import { ContextStore } from './contextStore';
import type { ToolResult } from './tools/types';
import type { Paragraph } from '../../client/stores/useBriefStore';
import type { PipelineStep, PipelineStepChild } from '../../shared/types';
import { writeSection, cleanupUncitedLaws, getSectionKey } from './pipeline/writerStep';
import { runLawFetch, truncateLawContent } from './pipeline/lawFetchStep';
import {
  runReasoningStrategy,
  type ReasoningStrategyProgressCallback,
} from './pipeline/reasoningStrategyStep';
import type {
  ReasoningStrategyInput,
  ReasoningStrategyOutput,
  PipelineContext,
} from './pipeline/types';
import { runCaseAnalysis } from './pipeline/caseAnalysisStep';

export type { PipelineContext } from './pipeline/types';

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
  const stepStartTimes: (number | null)[] = [null, null, null, null];

  const send = () => sendSSE({ type: 'pipeline_progress', steps: structuredClone(steps) });

  return {
    startStep: async (index: number) => {
      steps[index].status = 'running';
      stepStartTimes[index] = Date.now();
      await send();
    },
    completeStep: async (index: number, detail?: string, content?: Record<string, unknown>) => {
      steps[index].status = 'done';
      if (detail) steps[index].detail = detail;
      if (content) steps[index].content = content;
      if (stepStartTimes[index]) {
        steps[index].durationMs = Date.now() - stepStartTimes[index]!;
      }
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
    failStep: async (index: number, errorMsg: string) => {
      steps[index].status = 'error';
      steps[index].detail = errorMsg;
      if (stepStartTimes[index]) {
        steps[index].durationMs = Date.now() - stepStartTimes[index]!;
      }
      await send();
    },
    completeWriting: async (total: number) => {
      steps[STEP_WRITER] = {
        ...steps[STEP_WRITER],
        label: '書狀撰寫',
        detail: `${total} 段完成`,
        status: 'done',
        durationMs: stepStartTimes[STEP_WRITER]
          ? Date.now() - stepStartTimes[STEP_WRITER]!
          : undefined,
      };
      await send();
    },
  };
};

// ── Main Pipeline ──

export const runBriefPipeline = async (ctx: PipelineContext): Promise<ToolResult> => {
  const pipelineStartTime = Date.now();
  const failedSections: string[] = [];
  const store = new ContextStore();
  const progress = createProgressTracker(ctx.sendSSE);
  let currentStep = STEP_CASE;

  try {
    // ═══ Step 0: Case Analysis ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(STEP_CASE);

    const step0 = await runCaseAnalysis(ctx, store, {
      setChildren: (children) => progress.setStepChildren(STEP_CASE, children),
    });

    await progress.completeStep(STEP_CASE, step0.stepDetail, step0.stepContent);

    // Identify user-added laws (is_manual = true)
    const userAddedLaws = step0.allLawRefRows
      .filter((r) => r.is_manual && r.full_text)
      .map((r) => ({
        id: r.id,
        law_name: r.law_name,
        article_no: r.article,
        content: r.full_text,
      }));

    // ═══ Step 1: Law Fetch (pure function, no AI) ═══
    if (ctx.signal.aborted) return toolError('已取消');
    currentStep = STEP_LAW;
    await progress.startStep(STEP_LAW);

    const lawFetchChildren: PipelineStepChild[] = [];

    const lawFetchResult = await runLawFetch(
      ctx.mongoUrl,
      {
        legalIssues: store.legalIssues,
        userAddedLaws: step0.allLawRefRows.filter((r) => r.is_manual),
        existingLawRefs: step0.allLawRefRows,
      },
      ctx.mongoApiKey,
    );

    // Cache fetched laws in DB
    const fetchedLawsArray = [...lawFetchResult.laws.values()];

    // Build progress children showing actual law names
    const mentionedLaws = fetchedLawsArray.filter((l) => l.source === 'mentioned');
    const manualLaws = fetchedLawsArray.filter((l) => l.source === 'user_manual');

    if (mentionedLaws.length > 0) {
      lawFetchChildren.push({
        label: '提及法條',
        status: 'done',
        detail: `${mentionedLaws.length} 條`,
        results: mentionedLaws.map((l) => `${l.law_name} ${l.article_no}`),
      });
    }
    if (manualLaws.length > 0) {
      lawFetchChildren.push({
        label: '使用者手動法條',
        status: 'done',
        detail: `${manualLaws.length} 條`,
        results: manualLaws.map((l) => `${l.law_name} ${l.article_no}`),
      });
    }
    await progress.setStepChildren(STEP_LAW, [...lawFetchChildren]);
    const lawRefsToCache: LawRefItem[] = mentionedLaws.map((l) => ({
      id: l.id,
      law_name: l.law_name,
      article: l.article_no,
      full_text: l.content,
      is_manual: false,
    }));
    if (lawRefsToCache.length) {
      await upsertManyLawRefs(ctx.drizzle, ctx.caseId, lawRefsToCache);
    }

    await progress.completeStep(STEP_LAW, `${lawFetchResult.total} 條法條`);

    // ═══ Step 2: Reasoning + Strategy (Claude tool-loop) ═══
    if (ctx.signal.aborted) return toolError('已取消');
    currentStep = STEP_STRATEGY;
    await progress.startStep(STEP_STRATEGY);

    const strategyChildren: PipelineStepChild[] = [];
    const strategyProgress: ReasoningStrategyProgressCallback = {
      onReasoningStart: async () => {
        strategyChildren.push({ label: 'AI 法律推理中', status: 'running' });
        await progress.setStepChildren(STEP_STRATEGY, [...strategyChildren]);
      },
      onSearchLaw: async (query, purpose, resultCount, lawNames) => {
        strategyChildren.push({
          label: `補搜：${purpose}`,
          status: 'done',
          detail: resultCount > 0 ? `${resultCount} 條（${query}）` : `未找到（${query}）`,
          results: lawNames.length > 0 ? lawNames : undefined,
        });
        await progress.setStepChildren(STEP_STRATEGY, [...strategyChildren]);
      },
      onFinalized: async () => {
        // Mark reasoning as done
        const idx = strategyChildren.findIndex(
          (c) => c.label === 'AI 法律推理中' && c.status === 'running',
        );
        if (idx >= 0) {
          strategyChildren[idx] = { ...strategyChildren[idx], status: 'done' };
        }
        strategyChildren.push({ label: '推理完成，輸出策略', status: 'running' });
        await progress.setStepChildren(STEP_STRATEGY, [...strategyChildren]);
      },
      onOutputStart: async () => {
        const idx = strategyChildren.findLastIndex((c) => c.status === 'running');
        if (idx >= 0) {
          strategyChildren[idx] = { ...strategyChildren[idx], status: 'done' };
          await progress.setStepChildren(STEP_STRATEGY, [...strategyChildren]);
        }
      },
    };

    const strategyInput: ReasoningStrategyInput = {
      caseSummary: store.caseSummary,
      briefType: store.briefType,
      legalIssues: store.legalIssues,
      informationGaps: store.informationGaps,
      fetchedLaws: fetchedLawsArray
        .filter((l) => l.source !== 'user_manual')
        .map(truncateLawContent),
      fileSummaries: step0.parsedFiles.map((f) => ({
        id: f.id,
        filename: f.filename,
        category: f.category,
        summary: f.parsedSummary || '無摘要',
      })),
      damages: store.damages,
      timeline: store.timeline,
      userAddedLaws,
      caseMetadata: store.caseMetadata,
    };

    const strategyOutput: ReasoningStrategyOutput = await runReasoningStrategy(
      ctx,
      store,
      strategyInput,
      strategyProgress,
      step0.templateContentMd,
    );

    // Set found laws in ContextStore (fetchedLaws + supplementedLaws)
    store.setFoundLaws(fetchedLawsArray);

    // ═══ Common: Set strategy + persist claims ═══

    // Set strategy in ContextStore
    store.setStrategyOutput(strategyOutput.claims, strategyOutput.sections);

    // Persist claims to DB (batch to avoid D1's ~100 bound-param limit; 9 cols × 10 = 90)
    await ctx.drizzle.delete(claims).where(eq(claims.case_id, ctx.caseId));
    const now = new Date().toISOString();
    const CLAIM_BATCH_SIZE = 10;
    for (let i = 0; i < strategyOutput.claims.length; i += CLAIM_BATCH_SIZE) {
      const batch = strategyOutput.claims.slice(i, i + CLAIM_BATCH_SIZE);
      await ctx.drizzle.insert(claims).values(
        batch.map((c) => ({
          id: c.id,
          case_id: ctx.caseId,
          side: c.side,
          claim_type: c.claim_type,
          statement: c.statement,
          assigned_section: c.assigned_section,
          dispute_id: c.dispute_id,
          responds_to: c.responds_to,
          created_at: now,
        })),
      );
    }

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
        sections: strategyOutput.sections.map((s) => {
          const sectionClaims = strategyOutput.claims
            .filter((c) => s.claims.includes(c.id))
            .map((c) => ({
              side: c.side as 'ours' | 'theirs',
              statement: c.statement,
            }));
          return {
            id: s.id,
            section: s.section,
            subsection: s.subsection,
            claimCount: s.claims.length,
            claims: sectionClaims,
          };
        }),
        claimCount: strategyOutput.claims.length,
        rebuttalCount,
        unrebutted,
      },
    );

    // ═══ Step 3: Writer (sequential, uses strategy sections) ═══
    currentStep = STEP_WRITER;
    const paragraphs: Paragraph[] = [];

    for (let i = 0; i < store.sections.length; i++) {
      if (ctx.signal.aborted) break;

      const strategySection = store.sections[i];
      const sectionKey = getSectionKey(strategySection.section, strategySection.subsection);

      await progress.updateWriting(i + 1, store.sections.length, sectionKey);

      try {
        const writerCtx = store.getContextForSection(i);

        const paragraph = await writeSection(
          ctx,
          step0.briefId,
          strategySection,
          writerCtx,
          step0.fileContentMap,
          store,
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

    // ═══ Batch write all paragraphs to DB (single UPDATE instead of N SELECT+UPDATE) ═══
    if (paragraphs.length > 0) {
      await ctx.drizzle
        .update(briefs)
        .set({
          content_structured: JSON.stringify({ paragraphs }),
          updated_at: new Date().toISOString(),
        })
        .where(eq(briefs.id, step0.briefId));
    }

    // ═══ Cleanup: delete uncited non-manual law refs ═══
    await cleanupUncitedLaws(ctx, paragraphs);

    // Save version snapshot (one version for entire pipeline)
    const finalBrief = await ctx.drizzle.select().from(briefs).where(eq(briefs.id, step0.briefId));
    if (finalBrief.length) {
      const [{ value: versionCount }] = await ctx.drizzle
        .select({ value: count() })
        .from(briefVersions)
        .where(eq(briefVersions.brief_id, step0.briefId));
      await ctx.drizzle.insert(briefVersions).values({
        id: nanoid(),
        brief_id: step0.briefId,
        version_no: versionCount + 1,
        label: `AI 撰寫完成（${paragraphs.length} 段）`,
        content_structured: finalBrief[0].content_structured || JSON.stringify({ paragraphs: [] }),
        created_at: new Date().toISOString(),
        created_by: 'ai',
      });
    }

    // Report pipeline timing
    await ctx.sendSSE({
      type: 'pipeline_timing',
      totalDurationMs: Date.now() - pipelineStartTime,
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
    // loadReadyFiles throws a ToolResult when no files are ready — propagate it
    if (err && typeof err === 'object' && 'result' in err) return err as unknown as ToolResult;

    const errMsg = err instanceof Error ? err.message : '未知錯誤';
    // Mark whichever step was running as error so the UI shows the cause
    try {
      await progress.failStep(currentStep, errMsg);
    } catch {
      /* ignore SSE send failures during error handling */
    }
    return toolError(`Pipeline 執行失敗：${errMsg}`);
  }
};
