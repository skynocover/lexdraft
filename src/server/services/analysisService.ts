/**
 * Analysis service layer — shared core logic for disputes, damages, timeline.
 * Called by both API routes (direct) and agent tool handlers (via SSE).
 */
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { getDB } from '../db';
import { disputes, damages, cases } from '../db/schema';
import {
  loadReadyFiles,
  buildFileContext,
  parseSummaryText,
  sanitizeDbString,
  type FileContextOptions,
  type ReadyFile,
} from '../agent/toolHelpers';
import { callGeminiNative, type AIEnv } from '../agent/aiClient';
import {
  runCaseReader,
  runIssueAnalyzer,
  type OrchestratorProgressCallback,
  type OrchestratorOutput,
} from '../agent/orchestratorAgent';
import type { SimpleFact } from '../../shared/types';
import type { LegalIssue } from '../agent/pipeline/types';
import type { CaseMetadata } from '../agent/contextStore';
import type { AnalysisType } from '../../shared/types';

// ── Gemini Response Schemas ──

export const DAMAGES_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      category: { type: 'STRING', enum: ['財產上損害', '非財產上損害'] },
      description: { type: 'STRING' },
      amount: { type: 'INTEGER' },
      basis: { type: 'STRING' },
    },
    required: ['category', 'description', 'amount', 'basis'],
  },
};

export const TIMELINE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING' },
      title: { type: 'STRING' },
      description: { type: 'STRING' },
      is_critical: { type: 'BOOLEAN' },
    },
    required: ['date', 'title', 'description', 'is_critical'],
  },
};

const SYSTEM_PROMPT = '你是專業的台灣法律分析助手。';
const DEEP_ANALYSIS_TIMEOUT_MS = 120_000;

/** Safely load ready files, converting the sentinel throw to AnalysisFailure */
const safeLoadReadyFiles = async (
  db: D1Database,
  caseId: string,
): Promise<ReadyFile[] | AnalysisFailure> => {
  try {
    return await loadReadyFiles(db, caseId);
  } catch (e) {
    if (e && typeof e === 'object' && 'result' in e) {
      return { success: false, error: (e as { result: string }).result };
    }
    throw e;
  }
};

export type { AnalysisType };

export interface AnalysisSuccess<T = unknown> {
  success: true;
  data: T[];
  summary: string;
}

export interface AnalysisFailure {
  success: false;
  error: string;
}

export type AnalysisResult<T = unknown> = AnalysisSuccess<T> | AnalysisFailure;

// Extended result for deep dispute analysis — includes OrchestratorOutput for pipeline use
export interface DeepDisputeSuccess extends AnalysisSuccess {
  orchestratorOutput: OrchestratorOutput;
}

export type DeepDisputeResult = DeepDisputeSuccess | AnalysisFailure;

// ── Damage types ──

interface DamageItem {
  category: string;
  description: string;
  amount: number;
  basis: string;
}

// ── Timeline types ──

interface TimelineItem {
  id?: string;
  date: string;
  title: string;
  description: string;
  is_critical: boolean;
}

// ── Prompts (damages + timeline only; disputes uses deep analysis) ──

const buildDamagesPrompt = (
  fileContext: string,
): string => `請根據以下案件文件摘要，計算各項請求金額明細。

${fileContext}

category 只能是以下兩種之一：
- "財產上損害"：醫療費用、交通費用、工作損失、財物損害、貨款、利息、違約金等
- "非財產上損害"：精神慰撫金等
description 為該項目的具體名稱。
amount 為整數，以新台幣元計。如果文件中的「主張」欄位有列出明確金額，直接使用該精確金額。
重要：
- 不要使用 emoji 或特殊符號
- 不要包含「總計」或「合計」項目，只列出個別金額項目`;

const buildTimelinePrompt = (
  fileContext: string,
): string => `請根據以下案件文件摘要，產生時間軸事件列表。

${fileContext}

規則：
- date 格式為 YYYY-MM-DD，若只知年月則為 YYYY-MM-01，若只知年則為 YYYY-01-01
- 只使用文件中明確提及的日期，不要推測或虛構日期
- is_critical 標記法律程序關鍵節點（起訴、判決、鑑定、調解等），一般就醫或休養不算 critical
- 按日期從早到晚排序
- 不要使用 emoji 或特殊符號`;

// ── Core analysis runner (for damages + timeline) ──

interface AnalysisConfig<T> {
  fileContextOptions?: FileContextOptions;
  buildPrompt: (fileContext: string) => string;
  responseSchema: Record<string, unknown>;
  parseErrorLabel: string;
  emptyMessage: string;
  preProcess?: (items: T[]) => T[];
}

const ANALYSIS_CONFIGS: Record<'damages' | 'timeline', AnalysisConfig<unknown>> = {
  damages: {
    buildPrompt: buildDamagesPrompt,
    responseSchema: DAMAGES_SCHEMA,
    parseErrorLabel: '無法解析金額計算結果',
    emptyMessage: '未能識別出請求金額項目，請確認檔案已正確處理。',
  },
  timeline: {
    fileContextOptions: { includeDocDate: true },
    buildPrompt: buildTimelinePrompt,
    responseSchema: TIMELINE_SCHEMA,
    parseErrorLabel: '無法解析時間軸結果',
    emptyMessage: '未能從檔案中識別出時間軸事件。',
    preProcess: (items: unknown[]) => {
      const typed = items as TimelineItem[];
      typed.sort((a, b) => a.date.localeCompare(b.date));
      typed.forEach((item) => {
        if (!item.id) item.id = nanoid();
      });
      return typed as unknown[];
    },
  },
};

const runAnalysisCore = async <T>(
  config: AnalysisConfig<T>,
  caseId: string,
  db: D1Database,
  aiEnv: AIEnv,
  preloadedFiles?: ReadyFile[],
): Promise<AnalysisResult<T>> => {
  // 1. Load ready files (skip if caller already provides them)
  let readyFiles = preloadedFiles;
  if (!readyFiles) {
    const loaded = await safeLoadReadyFiles(db, caseId);
    if (!Array.isArray(loaded)) return loaded;
    readyFiles = loaded;
  }

  // 2. Build context + call Gemini
  const contextOptions: FileContextOptions = { enriched: true, ...config.fileContextOptions };
  const fileContext = buildFileContext(readyFiles, contextOptions);
  const prompt = config.buildPrompt(fileContext);

  let content: string;
  try {
    const result = await callGeminiNative(aiEnv, SYSTEM_PROMPT, prompt, {
      maxTokens: 8192,
      responseSchema: config.responseSchema,
      temperature: 0,
      thinkingBudget: 0,
    });
    content = result.content;
  } catch (e) {
    console.error('[analysisService] AI call failed:', e);
    return { success: false, error: config.parseErrorLabel };
  }

  // 3. Parse JSON
  let items: T[];
  try {
    items = JSON.parse(content) as T[];
  } catch {
    console.error(
      `[analysisService] JSON parse failed (first 500 chars): ${content.slice(0, 500)}`,
    );
    return { success: false, error: config.parseErrorLabel };
  }

  if (!items.length) {
    return { success: false, error: config.emptyMessage };
  }

  // 4. Pre-process
  if (config.preProcess) {
    items = config.preProcess(items);
  }

  return { success: true, data: items, summary: '' };
};

// ── Deep Dispute Analysis (Case Reader + Issue Analyzer) ──

interface DeepDisputeOptions {
  progress?: OrchestratorProgressCallback;
  signal?: AbortSignal;
  templateTitle?: string;
  readyFiles?: ReadyFile[];
  /** Pre-loaded case metadata — skips internal DB fetch when provided together with existingParties */
  caseMetadata?: CaseMetadata;
  existingParties?: { plaintiff: string | null; defendant: string | null };
}

export const runDeepDisputeAnalysis = async (
  caseId: string,
  db: D1Database,
  drizzle: ReturnType<typeof getDB>,
  aiEnv: AIEnv,
  options?: DeepDisputeOptions,
): Promise<DeepDisputeResult> => {
  // 1. Load ready files (skip if caller already provides them)
  let readyFiles = options?.readyFiles;
  if (!readyFiles) {
    const loaded = await safeLoadReadyFiles(db, caseId);
    if (!Array.isArray(loaded)) return loaded;
    readyFiles = loaded;
  }

  // 2. Load case metadata from DB (skip if caller provides both)
  let caseMetadata: CaseMetadata;
  let existingParties: { plaintiff: string | null; defendant: string | null };

  if (options?.caseMetadata && options?.existingParties) {
    caseMetadata = options.caseMetadata;
    existingParties = options.existingParties;
  } else {
    const caseRow = await drizzle
      .select({
        plaintiff: cases.plaintiff,
        defendant: cases.defendant,
        case_number: cases.case_number,
        court: cases.court,
        division: cases.division,
        client_role: cases.client_role,
        case_instructions: cases.case_instructions,
      })
      .from(cases)
      .where(eq(cases.id, caseId))
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
          },
      );

    caseMetadata = {
      caseNumber: caseRow.case_number || '',
      court: caseRow.court || '',
      division: caseRow.division || '',
      clientRole:
        caseRow.client_role === 'plaintiff' || caseRow.client_role === 'defendant'
          ? caseRow.client_role
          : '',
      caseInstructions: caseRow.case_instructions || '',
    };
    existingParties = {
      plaintiff: sanitizeDbString(caseRow.plaintiff),
      defendant: sanitizeDbString(caseRow.defendant),
    };
  }

  // 3. Assemble OrchestratorInput
  const orchestratorInput = {
    readyFiles: readyFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      category: f.category,
      summary: parseSummaryText(f.summary),
    })),
    existingParties,
    caseMetadata,
    templateTitle: options?.templateTitle ?? '',
  };

  // 4. Set up signal + progress
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), DEEP_ANALYSIS_TIMEOUT_MS);

  const externalSignal = options?.signal;
  const signal =
    externalSignal && AbortSignal.any
      ? AbortSignal.any([externalSignal, abortController.signal])
      : abortController.signal;

  const progress = options?.progress;

  try {
    // 5. Run Case Reader + Issue Analyzer
    let orchestratorOutput: OrchestratorOutput;
    try {
      const caseReaderOutput = await runCaseReader(
        aiEnv,
        drizzle,
        orchestratorInput,
        signal,
        progress,
      );

      let issueAnalyzerOutput;
      try {
        if (progress) await progress.onIssueAnalysisStart();
        issueAnalyzerOutput = await runIssueAnalyzer(
          aiEnv,
          caseReaderOutput,
          options?.templateTitle ?? '',
          signal,
          caseMetadata,
        );
      } catch (issueErr) {
        const msg = issueErr instanceof Error ? issueErr.message : String(issueErr);
        console.error('[analysisService] Issue Analyzer failed:', msg);
        return { success: false, error: `爭點分析失敗：${msg}` };
      }

      orchestratorOutput = {
        caseSummary: caseReaderOutput.caseSummary,
        parties: caseReaderOutput.parties,
        timelineSummary: caseReaderOutput.timelineSummary,
        legalIssues: issueAnalyzerOutput.legalIssues,
        undisputedFacts: issueAnalyzerOutput.undisputedFacts,
        informationGaps: issueAnalyzerOutput.informationGaps,
      };
    } catch (caseReaderErr) {
      const msg = caseReaderErr instanceof Error ? caseReaderErr.message : String(caseReaderErr);
      console.error('[analysisService] Case Reader failed:', msg);
      return { success: false, error: `案件讀取失敗：${msg}` };
    }

    if (!orchestratorOutput.legalIssues.length) {
      return { success: false, error: '未能識別出爭點，請確認檔案已正確處理。' };
    }

    // 6. Persist disputes + sync parties (parallel)
    const { plaintiff, defendant } = orchestratorOutput.parties;
    const [{ data, summary }] = await Promise.all([
      persistDisputes(
        orchestratorOutput.legalIssues,
        orchestratorOutput.undisputedFacts,
        orchestratorOutput.informationGaps,
        caseId,
        drizzle,
      ),
      plaintiff || defendant
        ? drizzle
            .update(cases)
            .set({
              ...(plaintiff ? { plaintiff } : {}),
              ...(defendant ? { defendant } : {}),
            })
            .where(eq(cases.id, caseId))
        : Promise.resolve(),
    ]);

    return { success: true, data, summary, orchestratorOutput };
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Persist functions ──

const DISPUTE_BATCH_SIZE = 10;

const persistDisputes = async (
  issues: LegalIssue[],
  undisputedFacts: SimpleFact[],
  informationGaps: string[],
  caseId: string,
  drizzle: ReturnType<typeof getDB>,
): Promise<{ data: Record<string, unknown>[]; summary: string }> => {
  // claims: pipeline Step 2 product, do NOT delete here (claims belong to brief context)
  // Delete old disputes + persist case-level analysis fields in parallel (independent tables)
  await Promise.all([
    drizzle.delete(disputes).where(eq(disputes.case_id, caseId)),
    drizzle
      .update(cases)
      .set({
        undisputed_facts: undisputedFacts.length > 0 ? JSON.stringify(undisputedFacts) : null,
        information_gaps: informationGaps.length > 0 ? JSON.stringify(informationGaps) : null,
      })
      .where(eq(cases.id, caseId)),
  ]);

  // Batch insert for D1 param limit
  for (let i = 0; i < issues.length; i += DISPUTE_BATCH_SIZE) {
    const batch = issues.slice(i, i + DISPUTE_BATCH_SIZE);
    await drizzle.insert(disputes).values(
      batch.map((issue, batchIndex) => ({
        id: issue.id,
        case_id: caseId,
        number: i + batchIndex + 1,
        title: issue.title,
        our_position: issue.our_position,
        their_position: issue.their_position,
        evidence: issue.key_evidence.length > 0 ? JSON.stringify(issue.key_evidence) : null,
        law_refs: issue.mentioned_laws.length > 0 ? JSON.stringify(issue.mentioned_laws) : null,
      })),
    );
  }

  // Return data with parsed JSON for frontend
  const data = issues.map((issue, i) => ({
    id: issue.id,
    case_id: caseId,
    number: i + 1,
    title: issue.title,
    our_position: issue.our_position,
    their_position: issue.their_position,
    evidence: issue.key_evidence,
    law_refs: issue.mentioned_laws,
  }));

  const summary = `已識別 ${issues.length} 個爭點：\n${issues.map((d, i) => `${i + 1}. ${d.title}`).join('\n')}`;
  return { data, summary };
};

const persistDamages = async (
  items: DamageItem[],
  caseId: string,
  drizzle: ReturnType<typeof getDB>,
): Promise<{ data: Record<string, unknown>[]; summary: string }> => {
  await drizzle.delete(damages).where(eq(damages.case_id, caseId));

  const records = items.map((d) => ({
    id: nanoid(),
    case_id: caseId,
    category: d.category,
    description: d.description || null,
    amount: d.amount,
    basis: d.basis || null,
    evidence_refs: null,
    created_at: new Date().toISOString(),
  }));

  if (records.length) {
    await drizzle.insert(damages).values(records);
  }

  const totalAmount = records.reduce((sum, d) => sum + d.amount, 0);
  const summary = `已計算 ${records.length} 項金額，請求總額 NT$ ${totalAmount.toLocaleString()}`;
  return { data: records, summary };
};

const persistTimeline = async (
  items: TimelineItem[],
  caseId: string,
  drizzle: ReturnType<typeof getDB>,
): Promise<{ data: TimelineItem[]; summary: string }> => {
  await drizzle
    .update(cases)
    .set({ timeline: JSON.stringify(items) })
    .where(eq(cases.id, caseId));

  const summary = `已產生 ${items.length} 個時間軸事件`;
  return { data: items, summary };
};

// ── Public API ──

export interface RunAnalysisOptions {
  readyFiles?: ReadyFile[];
}

export const runAnalysis = async (
  type: AnalysisType,
  caseId: string,
  db: D1Database,
  drizzle: ReturnType<typeof getDB>,
  aiEnv: AIEnv,
  options?: RunAnalysisOptions,
): Promise<AnalysisResult> => {
  // Disputes uses deep analysis (Case Reader + Issue Analyzer)
  if (type === 'disputes') {
    return runDeepDisputeAnalysis(caseId, db, drizzle, aiEnv, {
      readyFiles: options?.readyFiles,
    });
  }

  // Damages + Timeline use Gemini one-shot
  const config = ANALYSIS_CONFIGS[type];
  const result = await runAnalysisCore(config, caseId, db, aiEnv, options?.readyFiles);

  if (!result.success) {
    return result;
  }

  // Persist to DB
  if (type === 'damages') {
    const { data, summary } = await persistDamages(result.data as DamageItem[], caseId, drizzle);
    return { success: true, data, summary };
  }
  const { data, summary } = await persistTimeline(result.data as TimelineItem[], caseId, drizzle);
  return { success: true, data, summary };
};
