import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDB } from '../db'
import { files, briefs, disputes, damages, lawRefs, timelineEvents as timelineEventsTable } from '../db/schema'
import { searchLaw } from '../lib/lawSearch'
import { callClaudeWithCitations, type ClaudeDocument } from './claudeClient'
import { callAIStreaming, type AIEnv } from './aiClient'
import type { ToolDef } from './aiClient'
import type { SSEEvent } from '../../shared/types'
import type { Paragraph } from '../../client/stores/useBriefStore'

/**
 * Collect full text from an SSE streaming response.
 * Flushes the TextDecoder and strips U+FFFD replacement characters
 * that appear when multi-byte UTF-8 chars are split across chunks.
 */
async function collectStreamText(response: Response): Promise<string> {
  let text = ''
  const reader = response.body!.getReader()
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
        if (content) text += content
      } catch { /* skip */ }
    }
  }
  // Flush remaining bytes in decoder
  buffer += decoder.decode()
  if (buffer) {
    const lines = buffer.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const chunk = JSON.parse(data)
        const content = chunk.choices?.[0]?.delta?.content
        if (content) text += content
      } catch { /* skip */ }
    }
  }

  // Strip U+FFFD replacement characters from corrupted multi-byte sequences
  return text.replace(/\uFFFD/g, '')
}

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
  {
    type: 'function',
    function: {
      name: 'calculate_damages',
      description: '分析案件文件，計算各項請求金額明細。會自動載入所有已處理完成的檔案摘要（含 key_amounts），分析後寫入金額資料庫。',
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
      name: 'search_law',
      description: '搜尋法規條文。支援法規名稱（如「民法」）、特定條號（如「民法第184條」）、法律概念（如「損害賠償」）等搜尋方式。搜尋結果會自動寫入案件法條引用列表。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜尋關鍵字，例如「民法第184條」或「損害賠償」',
          },
          limit: {
            type: 'number',
            description: '回傳筆數上限，預設 10',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_timeline',
      description: '分析案件所有檔案，產生時間軸事件列表。自動載入所有已處理完成的檔案摘要，分析日期、事件等時間相關資訊，產生時間軸供律師參考。',
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
  mongoUrl: string
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

重要：絕對不要使用 emoji 或特殊符號（如 ✅❌🔷📄⚖️💰🔨 等），只用純中文文字和標點符號。
只回傳 JSON 陣列，不要其他文字。`

      const aiResponse = await callAIStreaming(ctx.aiEnv, {
        messages: [
          { role: 'system', content: '你是專業的台灣法律分析助手。' },
          { role: 'user', content: analysisPrompt },
        ],
      })

      const responseText = await collectStreamText(aiResponse)

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

      // 4. Clear old disputes for this case, then write new ones
      await drizzle.delete(disputes).where(eq(disputes.case_id, caseId))

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

    case 'calculate_damages': {
      if (!ctx) {
        return { result: 'Error: missing execution context', success: false }
      }

      // 1. Load all ready files with summaries
      const damageFileRows = await drizzle
        .select({
          id: files.id,
          filename: files.filename,
          category: files.category,
          summary: files.summary,
          extracted_claims: files.extracted_claims,
        })
        .from(files)
        .where(eq(files.case_id, caseId))

      const damageReadyFiles = damageFileRows.filter((f) => f.summary)
      if (!damageReadyFiles.length) {
        return { result: '沒有已處理完成的檔案，請先上傳並等待檔案處理完畢。', success: false }
      }

      // Build context for AI
      const damageFileContext = damageReadyFiles.map((f) => {
        const summary = f.summary ? JSON.parse(f.summary) : {}
        const claims = f.extracted_claims ? JSON.parse(f.extracted_claims) : []
        return `【${f.filename}】(${f.category})\n摘要：${summary.summary || '無'}\n金額：${summary.key_amounts ? JSON.stringify(summary.key_amounts) : '無'}\n主張：${claims.length > 0 ? claims.join('；') : '無'}`
      }).join('\n\n')

      // 2. Call AI for damage analysis
      const damagePrompt = `你是專業的台灣法律分析助手。請根據以下案件文件摘要，計算各項請求金額明細。

${damageFileContext}

請以 JSON 格式回傳金額項目列表，格式如下：
[
  {
    "category": "貨款",
    "description": "合約貨款尾款",
    "amount": 1200000,
    "basis": "依系爭買賣合約第5條",
    "evidence_refs": ["原證二"]
  }
]

金額 category 常見分類：貨款、利息、違約金、精神慰撫金、損害賠償、其他。
amount 為整數，以新台幣元計。
重要：絕對不要使用 emoji 或特殊符號（如 ✅❌🔷📄⚖️💰🔨 等），只用純中文文字和標點符號。
只回傳 JSON 陣列，不要其他文字。`

      const damageAiResponse = await callAIStreaming(ctx.aiEnv, {
        messages: [
          { role: 'system', content: '你是專業的台灣法律分析助手。' },
          { role: 'user', content: damagePrompt },
        ],
      })

      const damageResponseText = await collectStreamText(damageAiResponse)

      // 3. Parse damages from response
      let damageList: Array<{
        category: string
        description: string
        amount: number
        basis: string
        evidence_refs: string[]
      }> = []

      try {
        const jsonMatch = damageResponseText.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          damageList = JSON.parse(jsonMatch[0])
        }
      } catch {
        return { result: 'Error: 無法解析金額計算結果', success: false }
      }

      if (!damageList.length) {
        return { result: '未能識別出請求金額項目，請確認檔案已正確處理。', success: false }
      }

      // 4. Clear old damages for this case, then write new ones
      await drizzle.delete(damages).where(eq(damages.case_id, caseId))
      const damageRecords = damageList.map((d) => ({
        id: nanoid(),
        case_id: caseId,
        category: d.category,
        description: d.description || null,
        amount: d.amount,
        basis: d.basis || null,
        evidence_refs: JSON.stringify(d.evidence_refs || []),
        dispute_id: null,
        created_at: new Date().toISOString(),
      }))

      for (const record of damageRecords) {
        await drizzle.insert(damages).values(record)
      }

      // 5. Send SSE brief_update with set_damages
      const damageData = damageRecords.map((r) => ({
        ...r,
        evidence_refs: JSON.parse(r.evidence_refs),
      }))

      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: '',
        action: 'set_damages',
        data: damageData,
      })

      // 6. Return summary
      const totalAmount = damageRecords.reduce((sum, d) => sum + d.amount, 0)
      const damageSummary = damageRecords
        .map((d) => `- ${d.category}：NT$ ${d.amount.toLocaleString()}`)
        .join('\n')

      return {
        result: `已計算 ${damageRecords.length} 項金額：\n${damageSummary}\n\n請求總額：NT$ ${totalAmount.toLocaleString()}`,
        success: true,
      }
    }

    case 'search_law': {
      if (!ctx) {
        return { result: 'Error: missing execution context', success: false }
      }

      const query = args.query as string
      const limit = (args.limit as number) || 10
      if (!query) {
        return { result: 'Error: query is required', success: false }
      }

      const results = await searchLaw(ctx.mongoUrl, { query, limit })

      if (results.length === 0) {
        return { result: `未找到與「${query}」相關的法條。`, success: true }
      }

      // Upsert into D1 law_refs table
      for (const r of results) {
        try {
          const existing = await drizzle
            .select()
            .from(lawRefs)
            .where(eq(lawRefs.id, r._id))
          if (existing.length > 0) {
            await drizzle
              .update(lawRefs)
              .set({ usage_count: (existing[0].usage_count || 0) + 1 })
              .where(eq(lawRefs.id, r._id))
          } else {
            await drizzle.insert(lawRefs).values({
              id: r._id,
              case_id: caseId,
              law_name: r.law_name,
              article: r.article_no,
              title: `${r.law_name} ${r.article_no}`,
              full_text: r.content,
              usage_count: 1,
            })
          }
        } catch { /* skip on error */ }
      }

      // Read all law_refs for this case to send to frontend
      const allRefs = await drizzle
        .select()
        .from(lawRefs)
        .where(eq(lawRefs.case_id, caseId))

      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: '',
        action: 'set_law_refs',
        data: allRefs,
      })

      // Format result text
      const formatted = results
        .map((r) => `${r.law_name} ${r.article_no}：${r.content.slice(0, 80)}${r.content.length > 80 ? '...' : ''}`)
        .join('\n')

      return {
        result: `找到 ${results.length} 條相關法條：\n${formatted}`,
        success: true,
      }
    }

    case 'generate_timeline': {
      if (!ctx) {
        return { result: 'Error: missing execution context', success: false }
      }

      // Load all ready files with summaries
      const timelineFileRows = await drizzle
        .select({
          id: files.id,
          filename: files.filename,
          category: files.category,
          doc_date: files.doc_date,
          summary: files.summary,
        })
        .from(files)
        .where(eq(files.case_id, caseId))

      const timelineReadyFiles = timelineFileRows.filter((f) => f.summary)
      if (!timelineReadyFiles.length) {
        return { result: '沒有已處理完成的檔案，請先上傳並等待檔案處理完畢。', success: false }
      }

      const fileContext = timelineReadyFiles.map((f) => {
        const summary = f.summary ? JSON.parse(f.summary) : {}
        return `【${f.filename}】(${f.category})\n日期：${f.doc_date || '不明'}\n摘要：${summary.summary || '無'}`
      }).join('\n\n')

      const timelinePrompt = `你是專業的台灣法律分析助手。請根據以下案件文件摘要，產生時間軸事件列表。

${fileContext}

請以 JSON 格式回傳時間軸事件列表，格式如下：
[
  {
    "date": "2024-01-15",
    "title": "事件標題",
    "description": "事件詳細描述",
    "source_file": "來源檔案名稱",
    "is_critical": true
  }
]

規則：
- date 格式為 YYYY-MM-DD，若只知年月則為 YYYY-MM-01，若只知年則為 YYYY-01-01
- is_critical 為布林值，標記關鍵事件（如起訴、判決、簽約、違約等）
- 按日期從早到晚排序
- 重要：絕對不要使用 emoji 或特殊符號
- 只回傳 JSON 陣列，不要其他文字。`

      const timelineAiResponse = await callAIStreaming(ctx.aiEnv, {
        messages: [
          { role: 'system', content: '你是專業的台灣法律分析助手。' },
          { role: 'user', content: timelinePrompt },
        ],
      })

      const timelineResponseText = await collectStreamText(timelineAiResponse)

      let timelineEvents: Array<{
        date: string
        title: string
        description: string
        source_file: string
        is_critical: boolean
      }> = []

      try {
        const jsonMatch = timelineResponseText.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          timelineEvents = JSON.parse(jsonMatch[0])
        }
      } catch {
        return { result: 'Error: 無法解析時間軸結果', success: false }
      }

      if (!timelineEvents.length) {
        return { result: '未能從檔案中識別出時間軸事件。', success: false }
      }

      // Sort by date
      timelineEvents.sort((a, b) => a.date.localeCompare(b.date))

      // Persist to D1 — delete old events for this case, then insert new ones
      await drizzle.delete(timelineEventsTable).where(eq(timelineEventsTable.case_id, caseId))
      const now = new Date().toISOString()
      for (const evt of timelineEvents) {
        await drizzle.insert(timelineEventsTable).values({
          id: nanoid(),
          case_id: caseId,
          date: evt.date,
          title: evt.title,
          description: evt.description || '',
          source_file: evt.source_file || '',
          is_critical: evt.is_critical || false,
          created_at: now,
        })
      }

      // Send via SSE
      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: '',
        action: 'set_timeline',
        data: timelineEvents,
      })

      const timelineSummary = timelineEvents
        .map((e) => `${e.date} ${e.title}${e.is_critical ? ' (關鍵)' : ''}`)
        .join('\n')

      return {
        result: `已產生 ${timelineEvents.length} 個時間軸事件：\n${timelineSummary}`,
        success: true,
      }
    }

    default:
      return { result: `Unknown tool: ${toolName}`, success: false }
  }
}
