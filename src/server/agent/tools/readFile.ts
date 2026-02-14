import { eq } from 'drizzle-orm'
import { files } from '../../db/schema'
import type { ToolHandler } from './types'

export const handleReadFile: ToolHandler = async (args, _caseId, _db, drizzle) => {
  const fileId = args.file_id as string
  if (!fileId) {
    return { result: 'Error: file_id is required', success: false }
  }

  const rows = await drizzle
    .select({
      id: files.id,
      filename: files.filename,
      full_text: files.full_text,
      category: files.category,
      doc_type: files.doc_type,
    })
    .from(files)
    .where(eq(files.id, fileId))

  if (!rows.length) {
    return { result: `Error: file not found (id: ${fileId})`, success: false }
  }

  const file = rows[0]
  const text = file.full_text || '（無文字內容）'
  const truncated = text.length > 15000 ? text.slice(0, 15000) + '\n\n... [截斷，共 ' + text.length + ' 字]' : text

  return {
    result: `檔案：${file.filename}\n分類：${file.category}\n類型：${file.doc_type}\n\n全文內容：\n${truncated}`,
    success: true,
  }
}
