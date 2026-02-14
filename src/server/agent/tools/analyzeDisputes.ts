import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { disputes } from '../../db/schema'
import { callAIStreaming } from '../aiClient'
import { collectStreamText } from '../sseParser'
import { toolError, parseJsonField, loadReadyFiles } from '../toolHelpers'
import type { ToolHandler } from './types'

export const handleAnalyzeDisputes: ToolHandler = async (_args, caseId, db, drizzle, ctx) => {
  if (!ctx) {
    return toolError('Error: missing execution context')
  }

  // 1. Load all ready files with summaries
  let readyFiles
  try {
    readyFiles = await loadReadyFiles(db, caseId)
  } catch (e) {
    return e as { result: string; success: false }
  }

  // Build context for Gemini
  const fileContext = readyFiles.map((f) => {
    const summary = parseJsonField<Record<string, unknown>>(f.summary, {})
    const claims = parseJsonField<string[]>(f.extracted_claims, [])
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
