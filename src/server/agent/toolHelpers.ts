import { eq } from 'drizzle-orm';
import { getDB } from '../db';
import { files } from '../db/schema';

/** Standard error return for tool execution */
export function toolError(message: string): { result: string; success: false } {
  return { result: message, success: false };
}

/** Standard success return for tool execution */
export function toolSuccess(result: string): { result: string; success: true } {
  return { result, success: true };
}

/** Parse a JSON string field with fallback default value */
export function parseJsonField<T>(field: string | null | undefined, defaultValue: T): T {
  if (!field) return defaultValue;
  try {
    return JSON.parse(field) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Extract the outermost balanced JSON object from a string.
 * Handles nested braces correctly, skips braces inside strings.
 */
const extractBalancedJson = (text: string): string | null => {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // Unbalanced — return from start to last }
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace > start) {
    return text.slice(start, lastBrace + 1);
  }
  return null;
};

/**
 * Clean up common LLM JSON issues before parsing.
 * Handles: trailing commas, JS-style comments, markdown code blocks.
 */
export const cleanLLMJson = (raw: string): string => {
  let s = raw;
  // Remove markdown code block wrappers
  s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  // Remove single-line JS comments (but not inside strings — simplified)
  s = s.replace(/^(\s*)\/\/[^\n]*/gm, '$1');
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, '$1');
  return s;
};

/**
 * Extract and parse JSON from LLM response text.
 * Uses balanced-brace extraction, then tries parse with cleanup fallback.
 */
export const parseLLMJsonResponse = <T>(content: string, errorLabel: string): T => {
  const jsonStr = extractBalancedJson(content);
  if (!jsonStr) {
    throw new Error(`${errorLabel}（無法找到 JSON）`);
  }

  // Try direct parse first
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Fallback: clean common LLM issues and retry
    const cleaned = cleanLLMJson(jsonStr);
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Last resort: try greedy regex (covers edge cases where balanced extraction is too strict)
      const greedyMatch = content.match(/\{[\s\S]*\}/);
      if (greedyMatch && greedyMatch[0] !== jsonStr) {
        try {
          return JSON.parse(cleanLLMJson(greedyMatch[0])) as T;
        } catch {
          /* fall through */
        }
      }
      // Log the problematic JSON for debugging
      console.error(
        `[parseLLMJsonResponse] Failed to parse (first 500 chars): ${jsonStr.slice(0, 500)}`,
      );
      throw new Error(`${errorLabel}（JSON 格式錯誤）`);
    }
  }
};

/** Fields selected when loading ready files for analysis tools */
const READY_FILE_SELECT = {
  id: files.id,
  filename: files.filename,
  category: files.category,
  doc_date: files.doc_date,
  summary: files.summary,
  extracted_claims: files.extracted_claims,
} as const;

export type ReadyFile = {
  id: string;
  filename: string;
  category: string | null;
  doc_date: string | null;
  summary: string | null;
  extracted_claims: string | null;
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
