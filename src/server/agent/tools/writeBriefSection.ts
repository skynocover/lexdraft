import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { files, briefs } from '../../db/schema'
import { callClaudeWithCitations, type ClaudeDocument } from '../claudeClient'
import { parseJsonField } from '../toolHelpers'
import type { Paragraph } from '../../../client/stores/useBriefStore'
import type { ToolHandler } from './types'

export const handleWriteBriefSection: ToolHandler = async (args, caseId, _db, drizzle, ctx) => {
  if (!ctx) {
    return { result: 'Error: missing execution context', success: false }
  }

  const briefId = args.brief_id as string
  const section = args.section as string
  const subsection = (args.subsection as string) || ''
  const instruction = args.instruction as string
  const relevantFileIds = args.relevant_file_ids as string[]
  const disputeId = (args.dispute_id as string) || null

  if (!briefId || !section || !instruction || !relevantFileIds?.length) {
    return { result: 'Error: brief_id, section, instruction, relevant_file_ids are required', success: false }
  }

  // 1. Load file contents for document blocks
  const fileRows = await drizzle
    .select({
      id: files.id,
      filename: files.filename,
      full_text: files.full_text,
    })
    .from(files)
    .where(eq(files.case_id, caseId))

  const relevantFiles = fileRows.filter((f) => relevantFileIds.includes(f.id))
  if (!relevantFiles.length) {
    return { result: 'Error: no matching files found', success: false }
  }

  const documents: ClaudeDocument[] = relevantFiles.map((f) => ({
    title: f.filename,
    content: (f.full_text || '').slice(0, 20000),
    file_id: f.id,
  }))

  // 2. Call Claude with Citations
  const claudeInstruction = `你是一位專業的台灣律師助理。請根據提供的來源文件，撰寫法律書狀的一個段落。

撰寫要求：
- 章節：${section}
- 子章節：${subsection || '（無）'}
- 指示：${instruction}

撰寫規則：
- 使用正式法律文書用語（繁體中文）
- 論述要有邏輯、條理分明
- 如有法條引用，需正確標示法條名稱與條號
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 直接撰寫段落內容，不需要加入章節標題
- 段落長度控制在 150-300 字之間，簡潔有力`

  const { text, segments, citations } = await callClaudeWithCitations(
    ctx.aiEnv,
    documents,
    claudeInstruction,
  )

  // 3. Build Paragraph object
  const paragraph: Paragraph = {
    id: nanoid(),
    section,
    subsection,
    content_md: text,
    segments,
    dispute_id: disputeId,
    citations,
  }

  // 4. Read current brief content and append
  const briefRows = await drizzle
    .select()
    .from(briefs)
    .where(eq(briefs.id, briefId))

  if (!briefRows.length) {
    return { result: `Error: brief not found (id: ${briefId})`, success: false }
  }

  const brief = briefRows[0]
  const contentStructured = parseJsonField<{ paragraphs: Paragraph[] }>(
    brief.content_structured,
    { paragraphs: [] },
  )

  contentStructured.paragraphs.push(paragraph)

  // 5. Update DB
  await drizzle
    .update(briefs)
    .set({
      content_structured: JSON.stringify(contentStructured),
      updated_at: new Date().toISOString(),
    })
    .where(eq(briefs.id, briefId))

  // 6. Send SSE brief_update
  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: briefId,
    action: 'add_paragraph',
    data: paragraph,
  })

  return {
    result: `已撰寫段落「${section}${subsection ? ' > ' + subsection : ''}」，包含 ${citations.length} 個引用。`,
    success: true,
  }
}
