import { eq } from 'drizzle-orm';
import { getDB } from '../db';
import { files } from '../db/schema';
import { parseJsonField } from '../lib/jsonUtils';
import type { LegalIssue } from './pipeline/types';
// Re-export JSON utilities used by tool handlers
export { parseJsonField, parseLLMJsonResponse } from '../lib/jsonUtils';

// Re-export shared summary parser
export { parseSummaryText } from '../../shared/summaryUtils';

/** Treat DB string "null"/"undefined" as actual null */
export const sanitizeDbString = (val: string | null): string | null =>
  val === 'null' || val === 'undefined' ? null : val;

/** Standard error return for tool execution */
export function toolError(message: string): { result: string; success: false } {
  return { result: message, success: false };
}

/** Standard success return for tool execution */
export function toolSuccess(result: string): { result: string; success: true } {
  return { result, success: true };
}

/** Fields selected when loading ready files for analysis tools */
const READY_FILE_SELECT = {
  id: files.id,
  filename: files.filename,
  category: files.category,
  doc_date: files.doc_date,
  summary: files.summary,
} as const;

export type ReadyFile = {
  id: string;
  filename: string;
  category: string | null;
  doc_date: string | null;
  summary: string | null;
};

/**
 * Load all files for a case that have been processed (have summary).
 * Throws toolError if none found.
 */
export async function loadReadyFiles(db: D1Database, caseId: string): Promise<ReadyFile[]> {
  const drizzle = getDB(db);
  const fileRows = await drizzle
    .select(READY_FILE_SELECT)
    .from(files)
    .where(eq(files.case_id, caseId));

  const readyFiles = fileRows.filter((f) => f.summary);
  if (!readyFiles.length) {
    throw toolError('沒有已處理完成的檔案，請先上傳並等待檔案處理完畢。');
  }
  return readyFiles;
}

// ── Dispute Row → LegalIssue Mapper ──

export interface DisputeRow {
  id: string;
  title: string | null;
  our_position: string | null;
  their_position: string | null;
  evidence: string | null;
  law_refs: string | null;
}

/** Map a dispute DB row to a LegalIssue object */
export const mapDisputeToLegalIssue = (d: DisputeRow): LegalIssue => ({
  id: d.id,
  title: d.title || '未命名爭點',
  our_position: d.our_position || '',
  their_position: d.their_position || '',
  key_evidence: parseJsonField<string[]>(d.evidence, []),
  mentioned_laws: parseJsonField<string[]>(d.law_refs, []),
});

// ── File Context Builder ──

export interface FileContextOptions {
  includeDocDate?: boolean;
  enriched?: boolean;
}

/**
 * Build a text context string from ready files for analysis tool prompts.
 * When `enriched: true`, includes key_claims, key_amounts, key_dates from summary JSON.
 */
export const buildFileContext = (
  readyFiles: ReadyFile[],
  options: FileContextOptions = {},
): string => {
  return readyFiles
    .map((f) => {
      const lines: string[] = [`【${f.filename}】(${f.category})`];

      if (options.includeDocDate) {
        lines.push(`日期：${f.doc_date || '不明'}`);
      }

      // Parse summary JSON once, reuse for both summary text and enrichment fields
      let summaryText: string | null = null;
      let parsedObj: Record<string, unknown> | null = null;

      if (f.summary) {
        try {
          const parsed = JSON.parse(f.summary);
          if (typeof parsed === 'object' && parsed !== null) {
            summaryText = (parsed.summary as string) || null;
            parsedObj = parsed as Record<string, unknown>;
          } else {
            summaryText = String(parsed);
          }
        } catch {
          summaryText = f.summary;
        }
      }

      lines.push(`摘要：${summaryText || '無'}`);

      if (options.enriched && parsedObj) {
        const keyClaims = parsedObj.key_claims as string[] | undefined;
        const keyAmounts = parsedObj.key_amounts as number[] | undefined;
        const keyDates = parsedObj.key_dates as string[] | undefined;
        if (keyClaims?.length) lines.push(`主張：${keyClaims.join('；')}`);
        if (keyAmounts?.length)
          lines.push(
            `金額：${keyAmounts.map((a: number) => `NT$${a.toLocaleString()}`).join('、')}`,
          );
        if (keyDates?.length) lines.push(`相關日期：${keyDates.join('；')}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
};
