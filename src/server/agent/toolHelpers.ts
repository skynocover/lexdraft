import { eq } from 'drizzle-orm';
import { getDB } from '../db';
import { files } from '../db/schema';
import { callAIStreaming, type AIEnv } from './aiClient';
import { collectStreamText } from './sseParser';
import { parseJsonField } from '../lib/jsonUtils';

// Re-export JSON utilities for backward compatibility
export {
  parseJsonField,
  cleanLLMJson,
  parseLLMJsonResponse,
  repairTruncatedJson,
  parseLLMJsonArray,
} from '../lib/jsonUtils';

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

// ── File Context Builder ──

export interface FileContextOptions {
  includeClaims?: boolean;
  includeKeyAmounts?: boolean;
  includeDocDate?: boolean;
}

/**
 * Build a text context string from ready files for analysis tool prompts.
 * Field order: filename → 日期(optional) → 摘要 → 金額(optional) → 主張(optional)
 */
export const buildFileContext = (
  readyFiles: ReadyFile[],
  options: FileContextOptions = {},
): string => {
  return readyFiles
    .map((f) => {
      const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
      const lines: string[] = [`【${f.filename}】(${f.category})`];

      if (options.includeDocDate) {
        lines.push(`日期：${f.doc_date || '不明'}`);
      }

      lines.push(`摘要：${summary.summary || '無'}`);

      if (options.includeKeyAmounts) {
        lines.push(`金額：${summary.key_amounts ? JSON.stringify(summary.key_amounts) : '無'}`);
      }

      if (options.includeClaims) {
        const claims = (summary.key_claims as string[]) || [];
        lines.push(`主張：${claims.length > 0 ? claims.join('；') : '無'}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
};

// ── Analysis AI Caller ──

const ANALYSIS_SYSTEM_PROMPT = '你是專業的台灣法律分析助手。';

/**
 * Call AI with the standard analysis system prompt and collect full text response.
 * Used by analysis tools (disputes, damages, timeline).
 */
export const callAnalysisAI = async (aiEnv: AIEnv, prompt: string): Promise<string> => {
  const response = await callAIStreaming(aiEnv, {
    messages: [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });
  return collectStreamText(response);
};
