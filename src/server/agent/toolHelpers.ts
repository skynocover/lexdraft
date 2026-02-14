import { eq } from 'drizzle-orm'
import { getDB } from '../db'
import { files } from '../db/schema'

/** Standard error return for tool execution */
export function toolError(message: string): { result: string; success: false } {
  return { result: message, success: false }
}

/** Standard success return for tool execution */
export function toolSuccess(result: string): { result: string; success: true } {
  return { result, success: true }
}

/** Parse a JSON string field with fallback default value */
export function parseJsonField<T>(field: string | null | undefined, defaultValue: T): T {
  if (!field) return defaultValue
  try {
    return JSON.parse(field) as T
  } catch {
    return defaultValue
  }
}

/** Fields selected when loading ready files for analysis tools */
const READY_FILE_SELECT = {
  id: files.id,
  filename: files.filename,
  category: files.category,
  doc_date: files.doc_date,
  summary: files.summary,
  extracted_claims: files.extracted_claims,
} as const

export type ReadyFile = {
  id: string
  filename: string
  category: string | null
  doc_date: string | null
  summary: string | null
  extracted_claims: string | null
}

/**
 * Load all files for a case that have been processed (have summary).
 * Throws toolError if none found.
 */
export async function loadReadyFiles(
  db: D1Database,
  caseId: string,
): Promise<ReadyFile[]> {
  const drizzle = getDB(db)
  const fileRows = await drizzle
    .select(READY_FILE_SELECT)
    .from(files)
    .where(eq(files.case_id, caseId))

  const readyFiles = fileRows.filter((f) => f.summary)
  if (!readyFiles.length) {
    throw toolError('沒有已處理完成的檔案，請先上傳並等待檔案處理完畢。')
  }
  return readyFiles
}
