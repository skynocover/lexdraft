// ── Step 0: Case Analysis (案件分析) ──
// Extracted from briefPipeline.ts for readability and testability.
// Handles DB queries, dispute/damages/timeline analysis, template loading.

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs, cases, disputes, damages, templates } from '../../db/schema';
import { readLawRefs } from '../../lib/lawRefsJson';
import type { LawRefItem } from '../../lib/lawRefsJson';
import { type OrchestratorOutput, type OrchestratorProgressCallback } from '../orchestratorAgent';
import {
  parseJsonField,
  parseSummaryText,
  loadReadyFiles,
  mapDisputeToLegalIssue,
  sanitizeDbString,
} from '../toolHelpers';
import {
  runDeepDisputeAnalysis,
  runAnalysis as runAnalysisService,
  runDamagesWithDisputes,
  toDisputeInfoList,
  type DeepDisputeSuccess,
} from '../../services/analysisService';
import type { ContextStore } from '../contextStore';
import type { LegalIssue, TimelineItem, DamageItem, PipelineContext } from './types';
import { DEFAULT_TEMPLATES, getTemplateById, TEMPLATE_ID_AUTO } from '../../lib/defaultTemplates';
import type { PipelineStepChild } from '../../../shared/types';
import type { FileRow } from './writerStep';

// ── Output Types ──

export interface CaseAnalysisOutput {
  briefId: string;
  parsedFiles: Array<{
    id: string;
    filename: string;
    category: string | null;
    parsedSummary: string | null;
  }>;
  fileContentMap: Map<string, FileRow>;
  allLawRefRows: LawRefItem[];
  templateContentMd: string | null;
  // 給主函式用來 completeStep 的資料
  stepDetail: string;
  stepContent: Record<string, unknown>;
}

export interface CaseAnalysisProgress {
  setChildren: (children: PipelineStepChild[]) => Promise<void>;
}

// ── Main ──

export const runCaseAnalysis = async (
  ctx: PipelineContext,
  store: ContextStore,
  progress: CaseAnalysisProgress,
): Promise<CaseAnalysisOutput> => {
  // ── 1. Initial parallel DB queries ──
  let readyFiles: Awaited<ReturnType<typeof loadReadyFiles>>;
  let existingDisputes, existingDamages, briefId, caseRow;
  let allFileContents: {
    id: string;
    filename: string;
    full_text: string | null;
    content_md: string | null;
  }[];
  let allLawRefRows: LawRefItem[];
  try {
    [
      readyFiles,
      existingDisputes,
      existingDamages,
      briefId,
      caseRow,
      allFileContents,
      allLawRefRows,
    ] = await Promise.all([
      loadReadyFiles(ctx.db, ctx.caseId),
      ctx.drizzle.select().from(disputes).where(eq(disputes.case_id, ctx.caseId)),
      ctx.drizzle.select().from(damages).where(eq(damages.case_id, ctx.caseId)),
      createBriefInDB(ctx),
      ctx.drizzle
        .select({
          plaintiff: cases.plaintiff,
          defendant: cases.defendant,
          case_number: cases.case_number,
          court: cases.court,
          division: cases.division,
          client_role: cases.client_role,
          case_instructions: cases.case_instructions,
          timeline: cases.timeline,
          undisputed_facts: cases.undisputed_facts,
          information_gaps: cases.information_gaps,
          template_id: cases.template_id,
        })
        .from(cases)
        .where(eq(cases.id, ctx.caseId))
        .then(
          (rows) =>
            rows[0] || {
              plaintiff: null,
              defendant: null,
              case_number: null,
              court: null,
              division: null,
              client_role: null,
              case_instructions: null,
              timeline: null,
              undisputed_facts: null,
              information_gaps: null,
              template_id: null,
            },
        ),
      // File full text for Step 3 Writer (Citations API document blocks)
      ctx.drizzle
        .select({
          id: files.id,
          filename: files.filename,
          full_text: files.full_text,
          content_md: files.content_md,
        })
        .from(files)
        .where(eq(files.case_id, ctx.caseId)),
      // Existing law refs for Step 2 Strategist (user-added laws)
      readLawRefs(ctx.drizzle, ctx.caseId),
    ]);
  } catch (e) {
    // loadReadyFiles throws a ToolResult when no files are ready
    if (e && typeof e === 'object' && 'result' in e) throw e;
    throw e;
  }

  // ── 2. Parse & store initialization ──
  const existingTimeline = parseJsonField<TimelineItem[]>(caseRow.timeline, []);

  // Build file content map for Step 3 Writer (Citations API)
  const fileContentMap = new Map<string, FileRow>(allFileContents.map((f) => [f.id, f]));

  // Set up progress children for file reads
  const readChildren: PipelineStepChild[] = [];

  // Helper: push a new child or update an existing running child by label
  const pushChild = async (label: string, status: PipelineStepChild['status']) => {
    readChildren.push({ label, status });
    await progress.setChildren(readChildren);
  };
  const completeChild = async (label: string, status: 'done' | 'error' = 'done') => {
    const idx = readChildren.findIndex((c) => c.label === label && c.status === 'running');
    if (idx >= 0) {
      readChildren[idx] = { ...readChildren[idx], status };
      await progress.setChildren(readChildren);
    }
  };

  // Parse file summaries once — reused in both branches
  const parsedFiles = readyFiles.map((f) => ({
    id: f.id,
    filename: f.filename,
    category: f.category,
    parsedSummary: parseSummaryText(f.summary),
  }));

  // Resolve template title for display
  const resolvedTemplate = ctx.templateId ? getTemplateById(ctx.templateId) : undefined;
  store.templateTitle = resolvedTemplate?.title || ctx.title || '';
  store.caseMetadata = {
    caseNumber: caseRow.case_number || '',
    court: caseRow.court || '',
    division: caseRow.division || '',
    clientRole:
      caseRow.client_role === 'plaintiff' || caseRow.client_role === 'defendant'
        ? caseRow.client_role
        : '',
    caseInstructions: caseRow.case_instructions || '',
  };

  // ── 3. Load template (from ctx.templateId or case.template_id) ──
  let templateContentMd: string | null = null;
  const rawTemplateId = ctx.templateId || caseRow.template_id;
  const effectiveTemplateId = rawTemplateId === TEMPLATE_ID_AUTO ? null : rawTemplateId;
  if (effectiveTemplateId) {
    try {
      const dt = getTemplateById(effectiveTemplateId);
      if (dt) {
        templateContentMd = dt.content_md;
      } else {
        // Try user-created template from DB
        const tplRows = await ctx.drizzle
          .select({ content_md: templates.content_md })
          .from(templates)
          .where(eq(templates.id, effectiveTemplateId));
        templateContentMd = tplRows[0]?.content_md ?? null;
      }
    } catch (err) {
      console.error('[briefPipeline] Failed to load template:', err);
    }
  }

  // ── 4. Disputes → damages (sequential) + timeline (parallel) ──

  // Only skip if disputes have meaningful content (non-empty positions)
  const hasUsableDisputes =
    existingDisputes.length > 0 &&
    existingDisputes.some((d) => d.our_position?.trim() || d.their_position?.trim());

  // ── Dispute promise ──
  // Returns orchestratorOutput + any freshDamages produced by Stage 3
  const disputePromise = (async (): Promise<{
    orchestratorOutput: OrchestratorOutput | null;
    freshDamages: DamageItem[] | null;
  }> => {
    let freshDamages: DamageItem[] | null = null;
    let orchestratorOutput: OrchestratorOutput | null = null;

    if (hasUsableDisputes) {
      // Use existing disputes — skip Case Reader + Issue Analyzer entirely
      console.log(
        `Skipping Step 0: reusing ${existingDisputes.length} existing disputes for case ${ctx.caseId}`,
      );

      const existingLegalIssues: LegalIssue[] = existingDisputes.map(mapDisputeToLegalIssue);

      // Build caseSummary from pre-parsed file summaries (no LLM call)
      const caseSummary = parsedFiles
        .map((f) => `${f.filename}: ${f.parsedSummary || ''}`)
        .join('\n');

      orchestratorOutput = {
        caseSummary,
        parties: {
          plaintiff: sanitizeDbString(caseRow.plaintiff) || '',
          defendant: sanitizeDbString(caseRow.defendant) || '',
        },
        timelineSummary: '',
        legalIssues: existingLegalIssues,
        undisputedFacts: parseJsonField(caseRow.undisputed_facts, []),
        informationGaps: parseJsonField(caseRow.information_gaps, []),
      };

      store.seedFromOrchestrator(orchestratorOutput);

      // Show quick progress
      await pushChild('沿用既有爭點', 'done');
    } else {
      // No existing disputes — run deep analysis via shared service
      const orchestratorProgress: OrchestratorProgressCallback = {
        onFileReadStart: (filename) => pushChild(`閱讀 ${filename}`, 'running'),
        onFileReadDone: (filename) => completeChild(`閱讀 ${filename}`),
        onCaseSummaryStart: () => pushChild('案件摘要', 'running'),
        onCaseSummaryDone: () => completeChild('案件摘要'),
        onIssueAnalysisStart: () => pushChild('爭點分析', 'running'),
      };

      const result = await runDeepDisputeAnalysis(ctx.caseId, ctx.db, ctx.drizzle, ctx.aiEnv, {
        progress: orchestratorProgress,
        signal: ctx.signal,
        templateTitle: store.templateTitle,
        readyFiles,
        caseMetadata: store.caseMetadata,
        existingParties: {
          plaintiff: sanitizeDbString(caseRow.plaintiff),
          defendant: sanitizeDbString(caseRow.defendant),
        },
      });

      if (result.success) {
        const deepResult = result as DeepDisputeSuccess;
        orchestratorOutput = deepResult.orchestratorOutput;
        store.seedFromOrchestrator(orchestratorOutput);

        // Damages already analyzed in Stage 3 of runDeepDisputeAnalysis
        if (deepResult.damagesData.length > 0) {
          freshDamages = (
            deepResult.damagesData as Array<{
              category: string;
              description: string | null;
              amount: number;
            }>
          ).map((d) => ({ category: d.category, description: d.description, amount: d.amount }));

          await ctx.sendSSE({
            type: 'brief_update',
            brief_id: '',
            action: 'set_damages',
            data: deepResult.damagesData,
          });
          await pushChild('分析金額', 'done');
        }

        // Send SSE events for frontend
        await ctx.sendSSE({
          type: 'brief_update',
          brief_id: '',
          action: 'set_disputes',
          data: deepResult.data,
        });

        await ctx.sendSSE({
          type: 'brief_update',
          brief_id: '',
          action: 'set_undisputed_facts',
          data: orchestratorOutput.undisputedFacts,
        });

        await ctx.sendSSE({
          type: 'brief_update',
          brief_id: '',
          action: 'set_information_gaps',
          data: orchestratorOutput.informationGaps,
        });

        await ctx.sendSSE({
          type: 'brief_update',
          brief_id: '',
          action: 'set_parties',
          data: orchestratorOutput.parties,
        });
      } else {
        // Fallback already happened inside runDeepDisputeAnalysis;
        // reload disputes from DB and seed store
        const disputeList = await ctx.drizzle
          .select()
          .from(disputes)
          .where(eq(disputes.case_id, ctx.caseId));
        store.seedFromDisputes(disputeList);
      }
    }

    return { orchestratorOutput, freshDamages };
  })();

  // ── Damages promise ──
  // If disputes ran fresh, damages are already produced by Stage 3 of runDeepDisputeAnalysis.
  // Otherwise: reuse existing or run standalone (for reused-disputes + no-damages case).
  const damagesPromise = (async (): Promise<{
    damages: DamageItem[];
    orchestratorOutput: OrchestratorOutput | null;
  }> => {
    // Wait for dispute promise to finish — it may have produced damages in Stage 3
    const { freshDamages, orchestratorOutput } = await disputePromise;

    // Case 1: damages already produced by runDeepDisputeAnalysis Stage 3
    if (freshDamages) return { damages: freshDamages, orchestratorOutput };

    // Case 2: reuse existing damages
    if (existingDamages.length > 0) {
      await pushChild('沿用既有金額', 'done');
      const damages = existingDamages.map((d) => ({
        category: d.category,
        description: d.description,
        amount: d.amount,
      }));
      return { damages, orchestratorOutput };
    }

    // Case 3: disputes were reused but no existing damages — run standalone
    await pushChild('分析金額', 'running');

    // Use already-loaded existingDisputes instead of re-querying DB
    let result;
    if (existingDisputes.length > 0) {
      result = await runDamagesWithDisputes(
        ctx.caseId,
        ctx.db,
        ctx.drizzle,
        ctx.aiEnv,
        toDisputeInfoList(existingDisputes),
        { readyFiles },
      );
    } else {
      result = await runAnalysisService('damages', ctx.caseId, ctx.db, ctx.drizzle, ctx.aiEnv, {
        readyFiles,
      });
    }

    await completeChild('分析金額', result.success ? 'done' : 'error');
    if (!result.success) return { damages: [], orchestratorOutput };

    await ctx.sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_damages',
      data: result.data,
    });

    const damages = (
      result.data as Array<{ category: string; description: string | null; amount: number }>
    ).map((d) => ({ category: d.category, description: d.description, amount: d.amount }));
    return { damages, orchestratorOutput };
  })();

  // ── Timeline promise ──
  const timelinePromise = (async (): Promise<TimelineItem[]> => {
    if (existingTimeline.length > 0) {
      await pushChild('沿用既有時間軸', 'done');
      return existingTimeline;
    }

    await pushChild('分析時間軸', 'running');

    const result = await runAnalysisService(
      'timeline',
      ctx.caseId,
      ctx.db,
      ctx.drizzle,
      ctx.aiEnv,
      { readyFiles },
    );

    await completeChild('分析時間軸', result.success ? 'done' : 'error');

    if (!result.success) return [];

    // Send SSE for frontend
    await ctx.sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_timeline',
      data: result.data,
    });

    return result.data as TimelineItem[];
  })();

  // ── 5. Await results ──
  // damagesPromise internally awaits disputePromise (sequential dependency),
  // so we only need to parallel-await damages + timeline.
  const [damagesResult, finalTimeline] = await Promise.all([damagesPromise, timelinePromise]);
  const { damages: finalDamages, orchestratorOutput } = damagesResult;

  // Store damages + timeline in ContextStore
  store.damages = finalDamages;
  store.timeline = finalTimeline;

  // Clean up: mark any stale running children as done
  let childrenChanged = false;
  for (let i = 0; i < readChildren.length; i++) {
    if (readChildren[i].status === 'running') {
      readChildren[i] = { ...readChildren[i], status: 'done' };
      childrenChanged = true;
    }
  }
  if (childrenChanged) {
    await progress.setChildren(readChildren);
  }

  // ── 6. Build output ──
  const gaps = orchestratorOutput?.informationGaps ?? [];

  const stepDetail = `${readyFiles.length} 份檔案、${store.legalIssues.length} 個爭點、${finalDamages.length} 項金額、${finalTimeline.length} 個時間事件`;

  const stepContent: Record<string, unknown> = {
    type: 'case_confirm',
    files: readyFiles.map((f) => f.filename),
    issues: store.legalIssues.map((d) => ({
      id: d.id,
      title: d.title,
    })),
    parties: orchestratorOutput?.parties,
    gaps: gaps.length > 0 ? gaps : undefined,
  };

  return {
    briefId,
    parsedFiles,
    fileContentMap,
    allLawRefRows,
    templateContentMd,
    stepDetail,
    stepContent,
  };
};

// ── Helpers ──

const createBriefInDB = async (ctx: PipelineContext): Promise<string> => {
  const briefId = nanoid();
  const now = new Date().toISOString();

  await ctx.drizzle.insert(briefs).values({
    id: briefId,
    case_id: ctx.caseId,
    template_id: ctx.templateId,
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
      template_id: ctx.templateId,
      title: ctx.title,
      content_structured: { paragraphs: [] },
      version: 1,
      created_at: now,
      updated_at: now,
    },
  });

  return briefId;
};
