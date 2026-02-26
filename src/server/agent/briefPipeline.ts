import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs, cases, disputes, damages, briefVersions, claims } from '../db/schema';
import { getDB } from '../db';
import { type ClaudeUsage } from './claudeClient';
import { readLawRefs, upsertManyLawRefs } from '../lib/lawRefsJson';
import type { LawRefItem } from '../lib/lawRefsJson';
import {
  runCaseReader,
  runIssueAnalyzer,
  type OrchestratorOutput,
  type IssueAnalyzerOutput,
  type OrchestratorProgressCallback,
} from './orchestratorAgent';
import { parseJsonField, loadReadyFiles, toolError, toolSuccess } from './toolHelpers';
import { ContextStore } from './contextStore';
import type { LegalIssue, TimelineItem, DamageItem } from './pipeline/types';
import type { ToolResult } from './tools/types';
import type { Paragraph } from '../../client/stores/useBriefStore';
import type { AIEnv } from './aiClient';
import type { SSEEvent, PipelineStep, PipelineStepChild } from '../../shared/types';
import { writeSection, cleanupUncitedLaws, getSectionKey } from './pipeline/writerStep';
import type { FileRow } from './pipeline/writerStep';
import { runLawFetch, truncateLawContent } from './pipeline/lawFetchStep';
import {
  runReasoningStrategy,
  type ReasoningStrategyProgressCallback,
} from './pipeline/reasoningStrategyStep';
import type { ReasoningStrategyInput, ReasoningStrategyOutput } from './pipeline/types';

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
    failStep: async (index: number, errorMsg: string) => {
      steps[index].status = 'error';
      steps[index].detail = errorMsg;
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
  const progress = createProgressTracker(ctx.sendSSE);
  let currentStep = STEP_CASE;

  try {
    // ═══ Step 0: Case Reader + Issue Analyzer — 案件分析 ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(STEP_CASE);

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
            case_type: cases.case_type,
            client_role: cases.client_role,
            case_instructions: cases.case_instructions,
            timeline: cases.timeline,
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
                case_type: null,
                client_role: null,
                case_instructions: null,
                timeline: null,
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
      if (e && typeof e === 'object' && 'result' in e) return e as unknown as ToolResult;
      throw e;
    }

    // Parse existing timeline from DB
    const existingTimeline = parseJsonField<TimelineItem[]>(caseRow.timeline, []);

    // Build file content map for Step 3 Writer (Citations API)
    const fileContentMap = new Map<string, FileRow>(allFileContents.map((f) => [f.id, f]));

    // Set up progress children for file reads
    const readChildren: PipelineStepChild[] = [];

    // Parse file summaries once — reused in both branches
    const parsedFiles = readyFiles.map((f) => {
      const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
      return {
        id: f.id,
        filename: f.filename,
        category: f.category,
        parsedSummary: (summary.summary as string) || null,
      };
    });

    store.briefType = ctx.briefType;
    store.caseMetadata = {
      caseNumber: caseRow.case_number || '',
      court: caseRow.court || '',
      caseType: caseRow.case_type || '',
      clientRole: caseRow.client_role || '',
      caseInstructions: caseRow.case_instructions || '',
    };

    // ── Three-way parallel: disputes + damages + timeline (check-and-reuse) ──

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

        const existingLegalIssues: LegalIssue[] = existingDisputes.map((d) => ({
          id: d.id,
          title: d.title || '未命名爭點',
          our_position: d.our_position || '',
          their_position: d.their_position || '',
          key_evidence: parseJsonField<string[]>(d.evidence, []),
          mentioned_laws: parseJsonField<string[]>(d.law_refs, []),
          facts: [],
        }));

        // Build caseSummary from pre-parsed file summaries (no LLM call)
        const caseSummary = parsedFiles
          .map((f) => `${f.filename}: ${f.parsedSummary || ''}`)
          .join('\n');

        orchestratorOutput = {
          caseSummary,
          parties: {
            plaintiff: caseRow.plaintiff || '',
            defendant: caseRow.defendant || '',
          },
          timelineSummary: '',
          legalIssues: existingLegalIssues,
          informationGaps: [],
        };

        store.seedFromOrchestrator(orchestratorOutput);

        // Show quick progress
        readChildren.push({ label: '沿用既有爭點', status: 'done' });
        await progress.setStepChildren(STEP_CASE, [...readChildren]);
      } else {
        // No existing disputes — run full Case Reader + Issue Analyzer

        const orchestratorInput = {
          readyFiles: parsedFiles.map((f) => ({
            id: f.id,
            filename: f.filename,
            category: f.category,
            summary: f.parsedSummary,
          })),
          existingParties: { plaintiff: caseRow.plaintiff, defendant: caseRow.defendant },
          caseMetadata: {
            caseNumber: caseRow.case_number || '',
            court: caseRow.court || '',
            caseType: caseRow.case_type || '',
            clientRole: caseRow.client_role || '',
            caseInstructions: caseRow.case_instructions || '',
          },
          briefType: ctx.briefType,
        };

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
          onCaseSummaryStart: async () => {
            readChildren.push({ label: '案件摘要', status: 'running' });
            await progress.setStepChildren(STEP_CASE, [...readChildren]);
          },
          onCaseSummaryDone: async () => {
            const idx = readChildren.findIndex(
              (c) => c.label === '案件摘要' && c.status === 'running',
            );
            if (idx >= 0) {
              readChildren[idx] = { ...readChildren[idx], status: 'done' };
              await progress.setStepChildren(STEP_CASE, [...readChildren]);
            }
          },
          onIssueAnalysisStart: async () => {
            readChildren.push({ label: '爭點分析', status: 'running' });
            await progress.setStepChildren(STEP_CASE, [...readChildren]);
          },
        };

        // Shared fallback: run analyze_disputes
        const fallbackToAnalyzeDisputes = async () => {
          const { handleAnalyzeDisputes } = await import('./tools/analyzeDisputes');
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
              ctx.briefType,
              ctx.signal,
              store.caseMetadata,
            );
          } catch (issueErr) {
            console.error('Issue Analyzer failed, falling back to analyze_disputes:', issueErr);

            const disputeList = await fallbackToAnalyzeDisputes();
            issueAnalyzerOutput = {
              legalIssues: disputeList.map((d) => ({
                id: d.id,
                title: d.title || '未命名爭點',
                our_position: d.our_position || '',
                their_position: d.their_position || '',
                key_evidence: [],
                mentioned_laws: [],
                facts: [],
              })),
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
              batch.map((issue) => ({
                id: issue.id,
                case_id: ctx.caseId,
                number: 0,
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
        }
      }

      return orchestratorOutput;
    })();

    // ── Damages promise ──
    const damagesPromise = (async (): Promise<DamageItem[]> => {
      if (existingDamages.length > 0) {
        readChildren.push({ label: '沿用既有金額', status: 'done' });
        await progress.setStepChildren(STEP_CASE, [...readChildren]);
        return existingDamages.map((d) => ({
          category: d.category,
          description: d.description,
          amount: d.amount,
        }));
      }

      readChildren.push({ label: '分析金額', status: 'running' });
      await progress.setStepChildren(STEP_CASE, [...readChildren]);

      const { handleCalculateDamages } = await import('./tools/calculateDamages');
      const result = await handleCalculateDamages({}, ctx.caseId, ctx.db, ctx.drizzle, toolCtx);

      // Update progress child
      const idx = readChildren.findIndex((c) => c.label === '分析金額' && c.status === 'running');
      if (idx >= 0) {
        readChildren[idx] = {
          ...readChildren[idx],
          status: result.success ? 'done' : 'error',
        };
        await progress.setStepChildren(STEP_CASE, [...readChildren]);
      }

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
        readChildren.push({ label: '沿用既有時間軸', status: 'done' });
        await progress.setStepChildren(STEP_CASE, [...readChildren]);
        return existingTimeline;
      }

      readChildren.push({ label: '分析時間軸', status: 'running' });
      await progress.setStepChildren(STEP_CASE, [...readChildren]);

      const { handleGenerateTimeline } = await import('./tools/generateTimeline');
      const result = await handleGenerateTimeline({}, ctx.caseId, ctx.db, ctx.drizzle, toolCtx);

      // Update progress child
      const idx = readChildren.findIndex((c) => c.label === '分析時間軸' && c.status === 'running');
      if (idx >= 0) {
        readChildren[idx] = {
          ...readChildren[idx],
          status: result.success ? 'done' : 'error',
        };
        await progress.setStepChildren(STEP_CASE, [...readChildren]);
      }

      if (!result.success) return [];

      // Reload from DB
      const row = await ctx.drizzle
        .select({ timeline: cases.timeline })
        .from(cases)
        .where(eq(cases.id, ctx.caseId))
        .then((rows) => rows[0]);
      return parseJsonField<TimelineItem[]>(row?.timeline, []);
    })();

    // ── Await all three in parallel ──
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
      await progress.setStepChildren(STEP_CASE, [...readChildren]);
    }

    // Build step content
    const criticalGaps = orchestratorOutput
      ? orchestratorOutput.informationGaps
          .filter((g) => g.severity === 'critical')
          .map((g) => ({ description: g.description, suggestion: g.suggestion }))
      : [];

    await progress.completeStep(
      STEP_CASE,
      `${readyFiles.length} 份檔案、${store.legalIssues.length} 個爭點、${finalDamages.length} 項金額、${finalTimeline.length} 個時間事件`,
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

    // Identify user-added laws (is_manual = true)
    const userAddedLaws = allLawRefRows
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

    const lawFetchResult = await runLawFetch(ctx.mongoUrl, {
      legalIssues: store.legalIssues,
      userAddedLaws: allLawRefRows.filter((r) => r.is_manual),
      existingLawRefs: allLawRefRows,
    });

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
      fileSummaries: parsedFiles.map((f) => ({
        id: f.id,
        filename: f.filename,
        category: f.category,
        summary: f.parsedSummary || '無摘要',
      })),
      damages: finalDamages,
      timeline: finalTimeline,
      userAddedLaws,
      caseMetadata: store.caseMetadata,
    };

    const strategyOutput: ReasoningStrategyOutput = await runReasoningStrategy(
      ctx,
      store,
      strategyInput,
      totalUsage,
      strategyProgress,
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

    // ═══ Step 4: Writer (sequential, uses strategy sections) ═══
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
          briefId,
          strategySection,
          writerCtx,
          fileContentMap,
          store,
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

    // ═══ Batch write all paragraphs to DB (single UPDATE instead of N SELECT+UPDATE) ═══
    if (paragraphs.length > 0) {
      await ctx.drizzle
        .update(briefs)
        .set({
          content_structured: JSON.stringify({ paragraphs }),
          updated_at: new Date().toISOString(),
        })
        .where(eq(briefs.id, briefId));
    }

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

// ── Helpers ──

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
