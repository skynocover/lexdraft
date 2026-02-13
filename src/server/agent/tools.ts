import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDB } from '../db'
import { files, briefs, disputes } from '../db/schema'
import { callClaudeWithCitations, type ClaudeDocument } from './claudeClient'
import { callAIStreaming, type AIEnv } from './aiClient'
import type { ToolDef } from './aiClient'
import type { SSEEvent } from '../../shared/types'
import type { Paragraph } from '../../client/stores/useBriefStore'

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
  {
    type: 'function',
    function: {
      name: 'write_brief_section',
      description: '撰寫書狀的一個段落。使用 Claude Citations API 從來源文件中提取引用。需要先用 list_files 找到相關檔案。',
      parameters: {
        type: 'object',
        properties: {
          brief_id: {
            type: 'string',
            description: '書狀 ID',
          },
          section: {
            type: 'string',
            description: '段落所屬章節（如「壹、前言」、「貳、就被告各項抗辯之反駁」）',
          },
          subsection: {
            type: 'string',
            description: '子章節標題（如「一、關於貨物瑕疵之抗辯」），無則留空字串',
          },
          instruction: {
            type: 'string',
            description: '撰寫指示，說明這個段落要表達什麼論點',
          },
          relevant_file_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '相關來源檔案的 ID 列表',
          },
          dispute_id: {
            type: 'string',
            description: '關聯的爭點 ID（可選）',
          },
        },
        required: ['brief_id', 'section', 'subsection', 'instruction', 'relevant_file_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_brief',
      description: '建立一份新的書狀。撰寫書狀前必須先呼叫此工具取得 brief_id，再用 write_brief_section 逐段撰寫。',
      parameters: {
        type: 'object',
        properties: {
          brief_type: {
            type: 'string',
            enum: ['complaint', 'defense', 'preparation', 'appeal'],
            description: '書狀類型：complaint 起訴狀、defense 答辯狀、preparation 準備書狀、appeal 上訴狀',
          },
          title: {
            type: 'string',
            description: '書狀標題（如「民事準備二狀」、「民事答辯狀」）',
          },
        },
        required: ['brief_type', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_disputes',
      description: '分析案件所有檔案，識別雙方爭點。會自動載入所有已處理完成的檔案摘要和主張，分析後寫入爭點資料庫。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
]

interface ExecuteToolContext {
  sendSSE: (event: SSEEvent) => Promise<void>
  aiEnv: AIEnv
}

// Tool execution
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  caseId: string,
  db: D1Database,
  ctx?: ExecuteToolContext,
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

    case 'create_brief': {
      const briefType = args.brief_type as string
      const title = args.title as string

      if (!briefType || !title) {
        return { result: 'Error: brief_type and title are required', success: false }
      }

      const briefId = nanoid()
      const now = new Date().toISOString()

      await drizzle.insert(briefs).values({
        id: briefId,
        case_id: caseId,
        brief_type: briefType,
        title,
        content_structured: JSON.stringify({ paragraphs: [] }),
        version: 1,
        created_at: now,
        updated_at: now,
      })

      // Notify frontend so it can load the new brief
      if (ctx) {
        await ctx.sendSSE({
          type: 'brief_update',
          brief_id: briefId,
          action: 'create_brief',
          data: {
            id: briefId,
            case_id: caseId,
            brief_type: briefType,
            title,
            content_structured: { paragraphs: [] },
            version: 1,
            created_at: now,
            updated_at: now,
          },
        })
      }

      return {
        result: `已建立書狀「${title}」，brief_id: ${briefId}。請使用此 brief_id 搭配 write_brief_section 逐段撰寫內容。`,
        success: true,
      }
    }

    case 'write_brief_section': {
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
      let contentStructured: { paragraphs: Paragraph[] } = { paragraphs: [] }
      if (brief.content_structured) {
        try {
          contentStructured = JSON.parse(brief.content_structured)
        } catch {
          contentStructured = { paragraphs: [] }
        }
      }

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

    case 'analyze_disputes': {
      if (!ctx) {
        return { result: 'Error: missing execution context', success: false }
      }

      // 1. Load all ready files with summaries
      const fileRows = await drizzle
        .select({
          id: files.id,
          filename: files.filename,
          category: files.category,
          summary: files.summary,
          extracted_claims: files.extracted_claims,
        })
        .from(files)
        .where(eq(files.case_id, caseId))

      const readyFiles = fileRows.filter((f) => f.summary)
      if (!readyFiles.length) {
        return { result: '沒有已處理完成的檔案，請先上傳並等待檔案處理完畢。', success: false }
      }

      // Build context for Gemini
      const fileContext = readyFiles.map((f) => {
        const summary = f.summary ? JSON.parse(f.summary) : {}
        const claims = f.extracted_claims ? JSON.parse(f.extracted_claims) : []
        return `【${f.filename}】(${f.category})\n摘要：${summary.summary || '無'}\n主張：${claims.length > 0 ? claims.join('；') : '無'}`
      }).join('\n\n')

      // 2. Call Gemini for dispute analysis
      const analysisPrompt = `你是專業的台灣法律分析助手。請根據以下案件文件摘要，分析雙方的爭點。

${fileContext}

請以 JSON 格式回傳爭點列表，格式如下：
[
  {
    "number": 1,
    "title": "爭點標題",
    "our_position": "我方立場",
    "their_position": "對方立場",
    "evidence": ["相關證據1", "相關證據2"],
    "law_refs": ["民法第XXX條"],
    "priority": 1
  }
]

只回傳 JSON 陣列，不要其他文字。`

      const aiResponse = await callAIStreaming(ctx.aiEnv, {
        messages: [
          { role: 'system', content: '你是專業的台灣法律分析助手。' },
          { role: 'user', content: analysisPrompt },
        ],
      })

      // Parse streaming response to get full text
      let responseText = ''
      const reader = aiResponse.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const chunk = JSON.parse(data)
            const content = chunk.choices?.[0]?.delta?.content
            if (content) responseText += content
          } catch { /* skip */ }
        }
      }

      // 3. Parse disputes from response
      let disputeList: Array<{
        number: number
        title: string
        our_position: string
        their_position: string
        evidence: string[]
        law_refs: string[]
        priority: number
      }> = []

      try {
        // Extract JSON from response (might be wrapped in markdown code blocks)
        const jsonMatch = responseText.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          disputeList = JSON.parse(jsonMatch[0])
        }
      } catch {
        return { result: 'Error: 無法解析爭點分析結果', success: false }
      }

      if (!disputeList.length) {
        return { result: '未能識別出爭點，請確認檔案已正確處理。', success: false }
      }

      // 4. Write to disputes table
      const disputeRecords = disputeList.map((d) => ({
        id: nanoid(),
        case_id: caseId,
        number: d.number,
        title: d.title,
        our_position: d.our_position,
        their_position: d.their_position,
        evidence: JSON.stringify(d.evidence || []),
        law_refs: JSON.stringify(d.law_refs || []),
        priority: d.priority || 0,
      }))

      for (const record of disputeRecords) {
        await drizzle.insert(disputes).values(record)
      }

      // 5. Send SSE brief_update
      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: '',
        action: 'set_disputes',
        data: disputeRecords,
      })

      // 6. Return summary
      const summary = disputeRecords
        .map((d) => `${d.number}. ${d.title}`)
        .join('\n')

      return {
        result: `已識別 ${disputeRecords.length} 個爭點：\n${summary}`,
        success: true,
      }
    }

    default:
      return { result: `Unknown tool: ${toolName}`, success: false }
  }
}
