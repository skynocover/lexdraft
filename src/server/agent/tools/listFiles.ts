import { eq } from 'drizzle-orm'
import { files } from '../../db/schema'
import { parseJsonField } from '../toolHelpers'
import type { ToolHandler } from './types'

export const handleListFiles: ToolHandler = async (_args, caseId, _db, drizzle) => {
  const rows = await drizzle
    .select({
      id: files.id,
      filename: files.filename,
      category: files.category,
      status: files.status,
      doc_type: files.doc_type,
      doc_date: files.doc_date,
      summary: files.summary,
    })
    .from(files)
    .where(eq(files.case_id, caseId))

  const list = rows.map((f) => ({
    id: f.id,
    filename: f.filename,
    category: f.category,
    status: f.status,
    doc_type: f.doc_type,
    doc_date: f.doc_date,
    summary: parseJsonField(f.summary, null),
  }))

  return {
    result: JSON.stringify(list, null, 2),
    success: true,
  }
}
