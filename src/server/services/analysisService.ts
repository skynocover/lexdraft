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
import type { LegalIssue, DamageItem as BaseDamageItem } from '../agent/pipeline/types';
import type { CaseMetadata } from '../agent/contextStore';
import type { FileNote } from '../agent/prompts/orchestratorPrompt';
import type { AnalysisType } from '../../shared/types';
import { batchInsert } from '../lib/dbUtils';

// ── Gemini Response Schemas ──

const DAMAGES_BASE_PROPERTIES = {
  description: { type: 'STRING' },
  amount: { type: 'INTEGER' },
  basis: { type: 'STRING' },
};

const DAMAGES_BASE_REQUIRED = ['description', 'amount', 'basis'];

export const DAMAGES_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: DAMAGES_BASE_PROPERTIES,
    required: DAMAGES_BASE_REQUIRED,
  },
};

export const DAMAGES_WITH_DISPUTE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      ...DAMAGES_BASE_PROPERTIES,
      dispute_id: { type: 'STRING', nullable: true },
      evidence_refs: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: [...DAMAGES_BASE_REQUIRED, 'dispute_id', 'evidence_refs'],
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
  /** Populated when type='disputes' — damages analyzed with dispute context */
  damages?: Record<string, unknown>[];
  /** ISO 8601 UTC timestamp of when this analysis completed */
  analyzed_at?: string;
}

export interface AnalysisFailure {
  success: false;
  error: string;
}

export type AnalysisResult<T = unknown> = AnalysisSuccess<T> | AnalysisFailure;

// Extended result for deep dispute analysis — includes OrchestratorOutput + damages for pipeline use
export interface DeepDisputeSuccess extends AnalysisSuccess {
  orchestratorOutput: OrchestratorOutput;
  /** Damages analyzed with dispute context (Stage 3) */
  damagesData: Record<string, unknown>[];
}

export type DeepDisputeResult = DeepDisputeSuccess | AnalysisFailure;

// ── Damage types ──

interface DamageItem extends BaseDamageItem {
  basis: string;
  evidence_refs?: string[];
}

// ── Undisputed facts dedup ──
// Remove facts that mention specific NT$ amounts matching a damage item.
// This enforces data ownership: monetary claims live in `damages`, not in free-text facts.

const AMOUNT_RE = /(?:新臺幣|臺幣|新台幣|台幣|NT\$?\s*)[\d,]+元?/g;

const deduplicateUndisputedFacts = (
  facts: SimpleFact[],
  damageItems: DamageItem[],
): SimpleFact[] => {
  const damageAmounts = new Set(damageItems.map((d) => d.amount));
  const damageDescs = new Set(
    damageItems.map((d) => d.description?.trim()).filter((s): s is string => !!s),
  );
  return facts.filter((fact) => {
    const matches = fact.description.match(AMOUNT_RE);
    if (!matches) return true;
    for (const m of matches) {
      const num = parseInt(m.replace(/[^\d]/g, ''), 10);
      // Require both amount match AND description substring to avoid false positives
      if (damageAmounts.has(num) && hasDamageDescOverlap(fact.description, damageDescs)) {
        return false;
      }
    }
    return true;
  });
};

/** Check if fact text contains any damage description keyword */
const hasDamageDescOverlap = (factText: string, descs: Set<string>): boolean => {
  if (descs.size === 0) return true; // No descriptions available, fall back to amount-only
  for (const desc of descs) {
    if (factText.includes(desc)) return true;
  }
  return false;
};

// ── Timeline types ──

interface TimelineItem {
  id?: string;
  date: string;
  title: string;
  description: string;
  is_critical: boolean;
}

// ── Prompts (damages + timeline only; disputes uses deep analysis) ──

const DAMAGES_FIELD_RULES = `description 為該金額項目的具體名稱（如「醫療費用」「精神慰撫金」「不能工作損失」）。
amount 為整數，以新台幣元計。如果文件中的「主張」欄位有列出明確金額，直接使用該精確金額。`;

const DAMAGES_WARNINGS = `重要：
- 不要使用 emoji 或特殊符號
- 不要包含「總計」或「合計」項目，只列出個別金額項目`;

const buildDamagesPrompt = (
  fileContext: string,
): string => `請根據以下案件文件摘要，計算各項請求金額明細。

${fileContext}

${DAMAGES_FIELD_RULES}
${DAMAGES_WARNINGS}`;

export interface DisputeInfo {
  id: string;
  number: number;
  title: string;
}

/** Map DB dispute rows to DisputeInfo — shared by caseAnalysisStep + runAnalysis */
export const toDisputeInfoList = (
  rows: Array<{ id: string; number: number | null; title: string | null }>,
): DisputeInfo[] =>
  rows.map((d, i) => ({
    id: d.id,
    number: d.number ?? i + 1,
    title: d.title ?? '',
  }));

const formatKeyAmounts = (fileNotes?: FileNote[]): string => {
  if (!fileNotes?.length) return '';
  const lines = fileNotes
    .filter((n) => n.key_amounts.length > 0)
    .map((n) => `【${n.filename}】${n.key_amounts.join('、')}`);
  if (!lines.length) return '';
  return `\n[檔案金額明細]\n${lines.join('\n')}\n`;
};

export const buildDamagesPromptWithDisputes = (
  fileContext: string,
  disputeList: DisputeInfo[],
  fileNotes?: FileNote[],
): string => {
  const disputeLines = disputeList
    .map((d) => `- id: "${d.id}" — 爭點 ${d.number}: ${d.title}`)
    .join('\n');

  const keyAmountsBlock = formatKeyAmounts(fileNotes);

  return `請根據以下案件文件摘要，計算各項請求金額明細。

${fileContext}${keyAmountsBlock}

${DAMAGES_FIELD_RULES}
basis 為計算依據的具體說明，應包含金額的組成明細或計算方式。例如：
- 「急診醫療費3,850元＋住院費12,600元＋復健治療19,200元＋藥品及醫材4,350元＋門診回診費1,550元」
- 「計程車38次×350元/次」
- 「月薪52,000元×3個月」
- 「前輪總成更換4,200元＋右側車殼3,500元＋右後照鏡850元＋排氣管護蓋1,200元＋煞車拉桿600元＋工資2,500元」
evidence_refs 為該金額的來源文件名陣列（使用文件摘要中的原始檔名，如 "04_損害賠償明細.pdf"）。

${DAMAGES_WARNINGS}

以下是本案已識別的爭點：
${disputeLines}

請為每筆金額指定 dispute_id，填入最相關的爭點 id。
- 一個爭點可以對應多筆金額
- 如果某筆金額確實不屬於任何爭點，dispute_id 設為 null`;
};

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
    let caseReaderFileNotes: FileNote[] = [];
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
        legalIssues: issueAnalyzerOutput.legalIssues,
        undisputedFacts: issueAnalyzerOutput.undisputedFacts,
        informationGaps: issueAnalyzerOutput.informationGaps,
      };
      caseReaderFileNotes = caseReaderOutput.fileNotes;
    } catch (caseReaderErr) {
      const msg = caseReaderErr instanceof Error ? caseReaderErr.message : String(caseReaderErr);
      console.error('[analysisService] Case Reader failed:', msg);
      return { success: false, error: `案件讀取失敗：${msg}` };
    }

    if (!orchestratorOutput.legalIssues.length) {
      return { success: false, error: '未能識別出爭點，請確認檔案已正確處理。' };
    }

    // 6. Clean up old data (FK ordering: damages first, then disputes) + sync parties
    const aiPlaintiff = !existingParties.plaintiff ? orchestratorOutput.parties.plaintiff : null;
    const aiDefendant = !existingParties.defendant ? orchestratorOutput.parties.defendant : null;
    const partyUpdates = {
      ...(!existingParties.plaintiff && orchestratorOutput.parties.plaintiff
        ? { plaintiff: orchestratorOutput.parties.plaintiff }
        : {}),
      ...(!existingParties.defendant && orchestratorOutput.parties.defendant
        ? { defendant: orchestratorOutput.parties.defendant }
        : {}),
    };
    await Promise.all([
      drizzle.delete(damages).where(eq(damages.case_id, caseId)),
      drizzle
        .update(cases)
        .set({
          case_summary: orchestratorOutput.caseSummary || null,
          information_gaps:
            orchestratorOutput.informationGaps.length > 0
              ? JSON.stringify(orchestratorOutput.informationGaps)
              : null,
          ...partyUpdates,
        })
        .where(eq(cases.id, caseId)),
    ]);
    await drizzle.delete(disputes).where(eq(disputes.case_id, caseId));

    // 7. Insert disputes first (damages FK references disputes)
    const disputeList: DisputeInfo[] = orchestratorOutput.legalIssues.map((issue, i) => ({
      id: issue.id,
      number: i + 1,
      title: issue.title,
    }));
    const { data, summary } = await insertDisputes(orchestratorOutput.legalIssues, caseId, drizzle);
    const damagesResult = await runDamagesWithDisputes(caseId, db, drizzle, aiEnv, disputeList, {
      readyFiles,
      skipDelete: true,
      fileNotes: caseReaderFileNotes,
    });
    const damagesData = damagesResult.success
      ? (damagesResult.data as Record<string, unknown>[])
      : [];

    // 8. Dedup undisputed facts against damages, then write once
    if (damagesResult.success) {
      const damageItems = (damagesResult.data as DamageItem[]) ?? [];
      const deduped = deduplicateUndisputedFacts(orchestratorOutput.undisputedFacts, damageItems);
      if (deduped.length !== orchestratorOutput.undisputedFacts.length) {
        orchestratorOutput.undisputedFacts = deduped;
      }
    }

    // 9. Write undisputed_facts + disputes_analyzed_at once (after dedup)
    const analyzedAt = new Date().toISOString();
    await drizzle
      .update(cases)
      .set({
        undisputed_facts:
          orchestratorOutput.undisputedFacts.length > 0
            ? JSON.stringify(orchestratorOutput.undisputedFacts)
            : null,
        disputes_analyzed_at: analyzedAt,
      })
      .where(eq(cases.id, caseId));

    return {
      success: true,
      data,
      summary,
      orchestratorOutput,
      damagesData,
      analyzed_at: analyzedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Persist functions ──

/** Insert disputes into DB (deletes must be done by caller) */
const insertDisputes = async (
  issues: LegalIssue[],
  caseId: string,
  drizzle: ReturnType<typeof getDB>,
): Promise<{ data: Record<string, unknown>[]; summary: string }> => {
  const rows = issues.map((issue, i) => ({
    id: issue.id,
    case_id: caseId,
    number: i + 1,
    title: issue.title,
    our_position: issue.our_position,
    their_position: issue.their_position,
    evidence: issue.key_evidence.length > 0 ? JSON.stringify(issue.key_evidence) : null,
    law_refs: issue.mentioned_laws.length > 0 ? JSON.stringify(issue.mentioned_laws) : null,
  }));
  await batchInsert(drizzle, disputes, rows, 10);

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
  skipDelete = false,
): Promise<{ data: Record<string, unknown>[]; summary: string }> => {
  if (!skipDelete) {
    await drizzle.delete(damages).where(eq(damages.case_id, caseId));
  }

  const records = items.map((d) => ({
    id: nanoid(),
    case_id: caseId,
    description: d.description || null,
    amount: d.amount,
    basis: d.basis || null,
    // Gemini constrained decoding sometimes returns the string "null" instead of JSON null
    dispute_id: d.dispute_id && d.dispute_id !== 'null' ? d.dispute_id : null,
    evidence_refs:
      d.evidence_refs && d.evidence_refs.length > 0 ? JSON.stringify(d.evidence_refs) : null,
    created_at: new Date().toISOString(),
  }));

  await batchInsert(drizzle, damages, records, 12);

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
  /** Skip DELETE before INSERT — use when caller already cleared the table (e.g. persistDisputes) */
  skipDelete?: boolean;
  /** Stage 1 Case Reader 產出的 fileNotes，注入 key_amounts 給 damages prompt */
  fileNotes?: FileNote[];
}

/**
 * Run damages analysis with dispute context (Option A: Sequential).
 * Disputes must be analyzed first; their IDs are passed in so the AI
 * can assign each damage item to the most relevant dispute.
 */
export const runDamagesWithDisputes = async (
  caseId: string,
  db: D1Database,
  drizzle: ReturnType<typeof getDB>,
  aiEnv: AIEnv,
  disputeList: DisputeInfo[],
  options?: RunAnalysisOptions,
): Promise<AnalysisResult> => {
  // 1. Load ready files
  let readyFiles = options?.readyFiles;
  if (!readyFiles) {
    const loaded = await safeLoadReadyFiles(db, caseId);
    if (!Array.isArray(loaded)) return loaded;
    readyFiles = loaded;
  }

  // 2. Build context + dispute-aware prompt (inject key_amounts from Stage 1 if available)
  const fileContext = buildFileContext(readyFiles, { enriched: true });
  const prompt = buildDamagesPromptWithDisputes(fileContext, disputeList, options?.fileNotes);

  // 3. Call Gemini with dispute_id in schema
  let content: string;
  try {
    const result = await callGeminiNative(aiEnv, SYSTEM_PROMPT, prompt, {
      maxTokens: 8192,
      responseSchema: DAMAGES_WITH_DISPUTE_SCHEMA,
      temperature: 0,
      thinkingBudget: 0,
    });
    content = result.content;
  } catch (e) {
    console.error('[analysisService] AI call failed (damages+disputes):', e);
    return { success: false, error: '無法解析金額計算結果' };
  }

  // 4. Parse JSON
  let items: DamageItem[];
  try {
    items = JSON.parse(content) as DamageItem[];
  } catch {
    console.error(
      `[analysisService] JSON parse failed (first 500 chars): ${content.slice(0, 500)}`,
    );
    return { success: false, error: '無法解析金額計算結果' };
  }

  if (!items.length) {
    return { success: false, error: '未能識別出請求金額項目，請確認檔案已正確處理。' };
  }

  // 5. Validate dispute_ids — strip invalid ones rather than failing
  const validDisputeIds = new Set(disputeList.map((d) => d.id));
  for (const item of items) {
    if (item.dispute_id && !validDisputeIds.has(item.dispute_id)) {
      console.warn(
        `[analysisService] Invalid dispute_id "${item.dispute_id}" for "${item.description}", setting to null`,
      );
      item.dispute_id = null;
    }
  }

  // 6. Persist
  const { data, summary } = await persistDamages(items, caseId, drizzle, options?.skipDelete);
  return { success: true, data, summary };
};

export const runAnalysis = async (
  type: AnalysisType,
  caseId: string,
  db: D1Database,
  drizzle: ReturnType<typeof getDB>,
  aiEnv: AIEnv,
  options?: RunAnalysisOptions,
): Promise<AnalysisResult> => {
  // Disputes uses deep analysis (Case Reader + Issue Analyzer + Damages)
  if (type === 'disputes') {
    const result = await runDeepDisputeAnalysis(caseId, db, drizzle, aiEnv, {
      readyFiles: options?.readyFiles,
    });

    if (!result.success) return result;

    // damagesData is already populated by runDeepDisputeAnalysis Stage 3
    return { ...result, damages: (result as DeepDisputeSuccess).damagesData };
  }

  // Damages: try dispute-aware analysis if disputes exist
  if (type === 'damages') {
    const existingDisputes = await drizzle
      .select({ id: disputes.id, number: disputes.number, title: disputes.title })
      .from(disputes)
      .where(eq(disputes.case_id, caseId));

    if (existingDisputes.length > 0) {
      return runDamagesWithDisputes(
        caseId,
        db,
        drizzle,
        aiEnv,
        toDisputeInfoList(existingDisputes),
        options,
      );
    }

    // Fallback: no disputes yet, run without dispute context
    const result = await runAnalysisCore(
      ANALYSIS_CONFIGS.damages,
      caseId,
      db,
      aiEnv,
      options?.readyFiles,
    );
    if (!result.success) return result;
    const { data, summary } = await persistDamages(result.data as DamageItem[], caseId, drizzle);
    return { success: true, data, summary };
  }

  // Timeline uses Gemini one-shot
  const result = await runAnalysisCore(
    ANALYSIS_CONFIGS.timeline,
    caseId,
    db,
    aiEnv,
    options?.readyFiles,
  );
  if (!result.success) return result;
  const { data, summary } = await persistTimeline(result.data as TimelineItem[], caseId, drizzle);

  // Update timeline_analyzed_at timestamp
  const analyzedAt = new Date().toISOString();
  await drizzle.update(cases).set({ timeline_analyzed_at: analyzedAt }).where(eq(cases.id, caseId));

  return { success: true, data, summary, analyzed_at: analyzedAt };
};
