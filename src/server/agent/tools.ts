import { eq } from 'drizzle-orm'
import { getDB } from '../db'
import { files } from '../db/schema'
import type { ToolDef } from './aiClient'

// Tool definitions in OpenAI function calling format
export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出案件所有檔案，包含 id、filename、category、status、summary。用於了解案件有哪些卷宗文件。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '讀取指定檔案的全文內容（截斷 15000 字）。需要先用 list_files 取得檔案 id。',
      parameters: {
        type: 'object',
        properties: {
          file_id: {
            type: 'string',
            description: '要讀取的檔案 ID',
          },
        },
        required: ['file_id'],
      },
    },
  },
]

// Tool execution
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  caseId: string,
  db: D1Database,
): Promise<{ result: string; success: boolean }> {
  const drizzle = getDB(db)

  switch (toolName) {
    case 'list_files': {
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
        summary: f.summary ? JSON.parse(f.summary) : null,
      }))

      return {
        result: JSON.stringify(list, null, 2),
        success: true,
      }
    }

    case 'read_file': {
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

    default:
      return { result: `Unknown tool: ${toolName}`, success: false }
  }
}
