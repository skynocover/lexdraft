import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs, cases, disputes, damages, briefVersions, claims } from '../db/schema';
import { getDB } from '../db';
import { type ClaudeUsage } from './claudeClient';
import { readLawRefs, upsertManyLawRefs } from '../lib/lawRefsJson';
import type { LawRefItem } from '../lib/lawRefsJson';
import {
  runResearchAgent,
  type ResearchAgentResult,
  type ResearchProgressCallback,
} from './researchAgent';
import { createLawSearchSession } from '../lib/lawSearch';
import {
  runCaseReader,
  runIssueAnalyzer,
  type OrchestratorOutput,
  type IssueAnalyzerOutput,
  type OrchestratorProgressCallback,
} from './orchestratorAgent';
import { parseJsonField, loadReadyFiles, toolError, toolSuccess } from './toolHelpers';
import { ContextStore } from './contextStore';
import type { LegalIssue, FoundLaw } from './pipeline/types';
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

    // ── Branch: skip Step 0 if disputes already exist (save tokens) ──
    let orchestratorOutput: OrchestratorOutput | null = null;

    // Only skip if disputes have meaningful content (non-empty positions)
    const hasUsableDisputes =
      existingDisputes.length > 0 &&
      existingDisputes.some((d) => d.our_position?.trim() || d.their_position?.trim());

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
    currentStep = STEP_LAW;
    await progress.startStep(STEP_LAW);

    // Build case summary from file summaries for research context (cap at 4000 chars)
    const MAX_SUMMARY_LEN = 4000;
    const rawSummary =
      store.caseSummary ||
      readyFiles
        .map((f) => {
          const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
          return `${f.filename}: ${summary.summary || ''}`;
        })
        .join('\n');
    const caseSummaryForResearch =
      rawSummary.length > MAX_SUMMARY_LEN
        ? rawSummary.slice(0, MAX_SUMMARY_LEN) + '…（摘要已截斷）'
        : rawSummary;

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

    let researchResult;
    try {
      researchResult = await runResearchAgent(
        ctx.aiEnv,
        ctx.mongoUrl,
        {
          legalIssues: store.legalIssues.map((issue) => ({
            id: issue.id,
            title: issue.title,
            our_position: issue.our_position,
            their_position: issue.their_position,
            mentioned_laws: issue.mentioned_laws,
          })),
          caseSummary: caseSummaryForResearch,
          briefType: ctx.briefType,
        },
        ctx.signal,
        researchProgress,
      );
    } catch (researchErr) {
      const errDetail = researchErr instanceof Error ? researchErr.message : '未知錯誤';
      console.error('Research Agent failed, falling back to mentioned_laws lookup:', researchErr);

      // Show warning in progress children (full error in results for expansion)
      searchChildren.push({
        label: 'Research Agent 失敗',
        status: 'error',
        results: [errDetail],
      });
      searchChildren.push({ label: '改用 mentioned_laws 直接查詢', status: 'running' });
      await progress.setStepChildren(STEP_LAW, [...searchChildren]);

      // Fallback: batch-search mentioned_laws from existing issues via MongoDB
      researchResult = await fallbackResearchFromMentionedLaws(ctx.mongoUrl, store.legalIssues);

      // Update fallback child to done
      const fallbackIdx = searchChildren.findIndex(
        (c) => c.label === '改用 mentioned_laws 直接查詢',
      );
      if (fallbackIdx >= 0) {
        searchChildren[fallbackIdx] = { ...searchChildren[fallbackIdx], status: 'done' };
        await progress.setStepChildren(STEP_LAW, [...searchChildren]);
      }
    }

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
    currentStep = STEP_STRATEGY;
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
    currentStep = STEP_WRITER;
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

// ── Research fallback: look up mentioned_laws directly from MongoDB ──

const fallbackResearchFromMentionedLaws = async (
  mongoUrl: string,
  legalIssues: LegalIssue[],
): Promise<ResearchAgentResult> => {
  const searchedLawIds = new Set<string>();
  let totalSearches = 0;

  // Collect all unique mentioned_laws across all issues
  const allMentioned = new Map<string, string[]>(); // query → issue IDs
  for (const issue of legalIssues) {
    for (const law of issue.mentioned_laws) {
      const trimmed = law.trim();
      if (!trimmed) continue;
      const existing = allMentioned.get(trimmed) || [];
      existing.push(issue.id);
      allMentioned.set(trimmed, existing);
    }
  }

  // If no mentioned_laws at all, use issue titles as search queries
  if (allMentioned.size === 0) {
    for (const issue of legalIssues) {
      const title = issue.title.trim();
      if (!title) continue;
      allMentioned.set(title, [issue.id]);
    }
  }

  // Search each mentioned law
  const lawSession = createLawSearchSession(mongoUrl);
  const foundByIssue = new Map<string, FoundLaw[]>();

  try {
    for (const [query, issueIds] of allMentioned) {
      totalSearches++;
      const results = await lawSession.search(query, 3);

      for (const r of results) {
        searchedLawIds.add(r._id);
        const foundLaw: FoundLaw = {
          id: r._id,
          law_name: r.law_name,
          article_no: r.article_no,
          content: r.content,
          relevance: `與爭點相關（從 mentioned_laws 查詢）`,
          side: 'attack',
        };

        for (const issueId of issueIds) {
          const arr = foundByIssue.get(issueId) || [];
          // Avoid duplicates
          if (!arr.some((l) => l.id === foundLaw.id)) {
            arr.push(foundLaw);
          }
          foundByIssue.set(issueId, arr);
        }
      }
    }
  } finally {
    await lawSession.close();
  }

  // Build research results
  const research = legalIssues.map((issue) => ({
    issue_id: issue.id,
    strength: 'moderate' as const,
    found_laws: foundByIssue.get(issue.id) || [],
    analysis: '透過 mentioned_laws 直接查詢法條（Research Agent 未執行）。',
    attack_points: [],
    defense_risks: [],
  }));

  return { research, searchedLawIds, totalSearches };
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
