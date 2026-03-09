// ── Step 0: Case Analysis (案件分析) ──
// Extracted from briefPipeline.ts for readability and testability.
// Handles DB queries, dispute/damages/timeline analysis, template loading.

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs, cases, disputes, damages, templates } from '../../db/schema';
import { readLawRefs } from '../../lib/lawRefsJson';
import type { LawRefItem } from '../../lib/lawRefsJson';
import {
  runCaseReader,
  runIssueAnalyzer,
  type OrchestratorOutput,
  type IssueAnalyzerOutput,
  type OrchestratorProgressCallback,
} from '../orchestratorAgent';
import {
  parseJsonField,
  parseSummaryText,
  loadReadyFiles,
  mapDisputeToLegalIssue,
} from '../toolHelpers';
import type { ToolResult } from '../tools/types';
import type { ContextStore } from '../contextStore';
import type { LegalIssue, TimelineItem, DamageItem, PipelineContext } from './types';
import { DEFAULT_TEMPLATES, getTemplateById } from '../../lib/defaultTemplates';
import type { PipelineStepChild } from '../../../shared/types';
import type { FileRow } from './writerStep';

/** Treat DB string "null"/"undefined" as actual null */
const sanitizeDbString = (val: string | null): string | null =>
  val === 'null' || val === 'undefined' ? null : val;

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
  const effectiveTemplateId = rawTemplateId === 'auto' ? null : rawTemplateId;
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

  // ── 4. Three-way parallel: disputes + damages + timeline ──

  // Only skip if disputes have meaningful content (non-empty positions)
  const hasUsableDisputes =
    existingDisputes.length > 0 &&
    existingDisputes.some((d) => d.our_position?.trim() || d.their_position?.trim());

  // Tool context for calling existing tool handlers
  const toolCtx = {
    sendSSE: ctx.sendSSE,
    aiEnv: ctx.aiEnv,
    mongoUrl: ctx.mongoUrl,
  };

  // ── Dispute promise ──
  const disputePromise = (async (): Promise<OrchestratorOutput | null> => {
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
        informationGaps: [],
      };

      store.seedFromOrchestrator(orchestratorOutput);

      // Show quick progress
      await pushChild('沿用既有爭點', 'done');
    } else {
      // No existing disputes — run full Case Reader + Issue Analyzer

      const orchestratorInput = {
        readyFiles: parsedFiles.map((f) => ({
          id: f.id,
          filename: f.filename,
          category: f.category,
          summary: f.parsedSummary,
        })),
        existingParties: {
          plaintiff: sanitizeDbString(caseRow.plaintiff),
          defendant: sanitizeDbString(caseRow.defendant),
        },
        caseMetadata: store.caseMetadata,
        templateTitle: store.templateTitle,
      };

      const orchestratorProgress: OrchestratorProgressCallback = {
        onFileReadStart: (filename) => pushChild(`閱讀 ${filename}`, 'running'),
        onFileReadDone: (filename) => completeChild(`閱讀 ${filename}`),
        onCaseSummaryStart: () => pushChild('案件摘要', 'running'),
        onCaseSummaryDone: () => completeChild('案件摘要'),
        onIssueAnalysisStart: () => pushChild('爭點分析', 'running'),
      };

      // Shared fallback: run analyze_disputes
      const fallbackToAnalyzeDisputes = async () => {
        const { handleAnalyzeDisputes } = await import('../tools/analyzeDisputes');
        const result = await handleAnalyzeDisputes({}, ctx.caseId, ctx.db, ctx.drizzle, {
          sendSSE: ctx.sendSSE,
          aiEnv: ctx.aiEnv,
          mongoUrl: ctx.mongoUrl,
        });
        if (result.success) {
          return ctx.drizzle.select().from(disputes).where(eq(disputes.case_id, ctx.caseId));
        }
        return [];
      };

      try {
        // Agent 0a: Case Reader
        const caseReaderOutput = await runCaseReader(
          ctx.aiEnv,
          ctx.drizzle,
          orchestratorInput,
          ctx.signal,
          orchestratorProgress,
        );

        // Agent 0b: Issue Analyzer
        let issueAnalyzerOutput: IssueAnalyzerOutput;
        try {
          await orchestratorProgress.onIssueAnalysisStart();
          issueAnalyzerOutput = await runIssueAnalyzer(
            ctx.aiEnv,
            caseReaderOutput,
            store.templateTitle,
            ctx.signal,
            store.caseMetadata,
          );
        } catch (issueErr) {
          console.error('Issue Analyzer failed, falling back to analyze_disputes:', issueErr);

          const disputeList = await fallbackToAnalyzeDisputes();
          issueAnalyzerOutput = {
            legalIssues: disputeList.map(mapDisputeToLegalIssue),
            informationGaps: [],
          };
        }

        orchestratorOutput = {
          caseSummary: caseReaderOutput.caseSummary,
          parties: caseReaderOutput.parties,
          timelineSummary: caseReaderOutput.timelineSummary,
          legalIssues: issueAnalyzerOutput.legalIssues,
          informationGaps: issueAnalyzerOutput.informationGaps,
        };

        store.seedFromOrchestrator(orchestratorOutput);
      } catch (orchErr) {
        console.error('Case Reader failed, falling back to analyze_disputes:', orchErr);

        const disputeList = await fallbackToAnalyzeDisputes();
        store.seedFromDisputes(disputeList);
      }

      // Sync disputes to DB if Orchestrator produced new issues (batch for D1 param limit)
      if (orchestratorOutput && orchestratorOutput.legalIssues.length > 0) {
        await ctx.drizzle.delete(disputes).where(eq(disputes.case_id, ctx.caseId));
        const DISPUTE_BATCH_SIZE = 10;
        for (let i = 0; i < orchestratorOutput.legalIssues.length; i += DISPUTE_BATCH_SIZE) {
          const batch = orchestratorOutput.legalIssues.slice(i, i + DISPUTE_BATCH_SIZE);
          await ctx.drizzle.insert(disputes).values(
            batch.map((issue, batchIndex) => ({
              id: issue.id,
              case_id: ctx.caseId,
              number: i + batchIndex + 1,
              title: issue.title,
              our_position: issue.our_position,
              their_position: issue.their_position,
              evidence: issue.key_evidence.length > 0 ? JSON.stringify(issue.key_evidence) : null,
              law_refs:
                issue.mentioned_laws.length > 0 ? JSON.stringify(issue.mentioned_laws) : null,
            })),
          );
        }

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

        // Persist extracted parties back to cases table
        const { plaintiff, defendant } = orchestratorOutput.parties;
        if (plaintiff || defendant) {
          await ctx.drizzle
            .update(cases)
            .set({
              ...(plaintiff ? { plaintiff } : {}),
              ...(defendant ? { defendant } : {}),
            })
            .where(eq(cases.id, ctx.caseId));
        }
      }
    }

    return orchestratorOutput;
  })();

  // ── Damages promise ──
  const damagesPromise = (async (): Promise<DamageItem[]> => {
    if (existingDamages.length > 0) {
      await pushChild('沿用既有金額', 'done');
      return existingDamages.map((d) => ({
        category: d.category,
        description: d.description,
        amount: d.amount,
      }));
    }

    await pushChild('分析金額', 'running');

    const { handleCalculateDamages } = await import('../tools/calculateDamages');
    const result = await handleCalculateDamages({}, ctx.caseId, ctx.db, ctx.drizzle, toolCtx);

    await completeChild('分析金額', result.success ? 'done' : 'error');

    if (!result.success) return [];

    // Reload from DB (targeted select — only needed fields)
    return ctx.drizzle
      .select({
        category: damages.category,
        description: damages.description,
        amount: damages.amount,
      })
      .from(damages)
      .where(eq(damages.case_id, ctx.caseId));
  })();

  // ── Timeline promise ──
  const timelinePromise = (async (): Promise<TimelineItem[]> => {
    if (existingTimeline.length > 0) {
      await pushChild('沿用既有時間軸', 'done');
      return existingTimeline;
    }

    await pushChild('分析時間軸', 'running');

    const { handleGenerateTimeline } = await import('../tools/generateTimeline');
    const result = await handleGenerateTimeline({}, ctx.caseId, ctx.db, ctx.drizzle, toolCtx);

    await completeChild('分析時間軸', result.success ? 'done' : 'error');

    if (!result.success) return [];

    // Reload from DB
    const row = await ctx.drizzle
      .select({ timeline: cases.timeline })
      .from(cases)
      .where(eq(cases.id, ctx.caseId))
      .then((rows) => rows[0]);
    return parseJsonField<TimelineItem[]>(row?.timeline, []);
  })();

  // ── 5. Await all three in parallel ──
  const [orchestratorOutput, finalDamages, finalTimeline] = await Promise.all([
    disputePromise,
    damagesPromise,
    timelinePromise,
  ]);

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
  const criticalGaps = orchestratorOutput
    ? orchestratorOutput.informationGaps
        .filter((g) => g.severity === 'critical')
        .map((g) => ({ description: g.description, suggestion: g.suggestion }))
    : [];

  const stepDetail = `${readyFiles.length} 份檔案、${store.legalIssues.length} 個爭點、${finalDamages.length} 項金額、${finalTimeline.length} 個時間事件`;

  const stepContent: Record<string, unknown> = {
    type: 'case_confirm',
    files: readyFiles.map((f) => f.filename),
    issues: store.legalIssues.map((d) => ({
      id: d.id,
      title: d.title,
    })),
    parties: orchestratorOutput?.parties,
    gaps: criticalGaps.length > 0 ? criticalGaps : undefined,
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
