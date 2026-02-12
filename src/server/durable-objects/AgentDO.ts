import { DurableObject } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import { eq, asc } from 'drizzle-orm'
import { getDB } from '../db'
import { messages } from '../db/schema'
import { callAIStreaming, type ChatMessage, type ToolCall, type AIEnv } from '../agent/aiClient'
import { TOOL_DEFINITIONS, executeTool } from '../agent/tools'
import type { SSEEvent } from '../../shared/types'

const MAX_ROUNDS = 15

const SYSTEM_PROMPT = `你是 LexDraft AI 助理，一位專業的台灣法律分析助手。你的任務是協助律師分析案件卷宗、整理爭點、提供法律建議。

你可以使用以下工具：
- list_files：列出案件所有檔案
- read_file：讀取指定檔案的全文

工作流程：
1. 當律師要求分析案件時，先用 list_files 查看有哪些文件
2. 根據需要用 read_file 讀取相關文件
3. 綜合分析後提供專業的法律意見

回覆規則：
- 一律使用繁體中文
- 引用文件內容時標明出處（檔案名稱）
- 分析要有結構、條理分明
- 如果資訊不足，主動說明需要哪些額外資料`

interface Env {
  DB: D1Database
  CF_ACCOUNT_ID: string
  CF_GATEWAY_ID: string
  CF_AIG_TOKEN: string
}

export class AgentDO extends DurableObject<Env> {
  private abortController: AbortController | null = null

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/chat') {
      return this.handleChat(request)
    }
    if (request.method === 'POST' && url.pathname === '/cancel') {
      return this.handleCancel()
    }

    return new Response('Not found', { status: 404 })
  }

  private handleCancel(): Response {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async handleChat(request: Request): Promise<Response> {
    const { message, caseId } = (await request.json()) as { message: string; caseId: string }

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    const sendSSE = async (event: SSEEvent) => {
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      } catch {
        // Writer closed, ignore
      }
    }

    // Run agent loop asynchronously
    this.runAgentLoop(caseId, message, signal, sendSSE, writer).catch(async (err) => {
      console.error('Agent loop error:', err)
      await sendSSE({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
      await sendSSE({ type: 'done' })
      try { await writer.close() } catch { /* ignore */ }
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  private async runAgentLoop(
    caseId: string,
    userMessage: string,
    signal: AbortSignal,
    sendSSE: (event: SSEEvent) => Promise<void>,
    writer: WritableStreamDefaultWriter,
  ) {
    const db = getDB(this.env.DB)
    const aiEnv: AIEnv = {
      CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID,
      CF_GATEWAY_ID: this.env.CF_GATEWAY_ID,
      CF_AIG_TOKEN: this.env.CF_AIG_TOKEN,
    }

    // 1. Save user message
    const userMsgId = nanoid()
    await db.insert(messages).values({
      id: userMsgId,
      case_id: caseId,
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    })

    // 2. Load conversation history
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.case_id, caseId))
      .orderBy(asc(messages.created_at))

    // 3. Build OpenAI messages format
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ]

    for (const msg of history) {
      if (msg.role === 'user') {
        chatMessages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        const meta = msg.metadata ? JSON.parse(msg.metadata) : null
        if (meta?.tool_calls) {
          chatMessages.push({ role: 'assistant', content: msg.content || '', tool_calls: meta.tool_calls })
        } else {
          chatMessages.push({ role: 'assistant', content: msg.content })
        }
      } else if (msg.role === 'tool_result') {
        const meta = msg.metadata ? JSON.parse(msg.metadata) : null
        chatMessages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: meta?.tool_call_id || '',
        })
      }
      // Skip tool_call records (they're part of assistant messages)
    }

    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    // Agent loop
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal.aborted) {
        await sendSSE({ type: 'error', message: '已取消' })
        break
      }

      await sendSSE({ type: 'progress', current: round + 1, total: MAX_ROUNDS })

      // Call AI Gateway (streaming)
      const response = await callAIStreaming(aiEnv, {
        messages: chatMessages,
        tools: TOOL_DEFINITIONS,
        signal,
      })

      // Parse streaming response
      const assistantMsgId = nanoid()
      await sendSSE({ type: 'message_start', message_id: assistantMsgId, role: 'assistant' })

      let fullContent = ''
      const toolCalls: ToolCall[] = []
      const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map()

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        if (signal.aborted) break
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
            const chunk = JSON.parse(data) as {
              choices: Array<{
                delta: {
                  content?: string
                  tool_calls?: Array<{
                    index: number
                    id?: string
                    function?: { name?: string; arguments?: string }
                  }>
                }
                finish_reason?: string | null
              }>
              usage?: {
                prompt_tokens?: number
                completion_tokens?: number
                total_tokens?: number
              }
            }

            // Track usage from final chunk
            if (chunk.usage) {
              totalPromptTokens += chunk.usage.prompt_tokens || 0
              totalCompletionTokens += chunk.usage.completion_tokens || 0
            }

            const delta = chunk.choices?.[0]?.delta
            if (!delta) continue

            // Text content
            if (delta.content) {
              fullContent += delta.content
              await sendSSE({ type: 'text_delta', delta: delta.content })
            }

            // Tool calls (streamed incrementally)
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index
                if (!toolCallBuffers.has(idx)) {
                  toolCallBuffers.set(idx, { id: tc.id || '', name: '', args: '' })
                }
                const buf = toolCallBuffers.get(idx)!
                if (tc.id) buf.id = tc.id
                if (tc.function?.name) buf.name += tc.function.name
                if (tc.function?.arguments) buf.args += tc.function.arguments
              }
            }
          } catch {
            // Skip unparseable chunks
          }
        }
      }

      await sendSSE({ type: 'message_end', message_id: assistantMsgId })

      // Assemble complete tool calls
      for (const [, buf] of toolCallBuffers) {
        toolCalls.push({
          id: buf.id,
          type: 'function',
          function: { name: buf.name, arguments: buf.args },
        })
      }

      // Emit usage
      const totalTokens = totalPromptTokens + totalCompletionTokens
      // Gemini 2.5 Flash pricing: ~$0.15/1M input, ~$0.60/1M output (approximate)
      const costUsd = (totalPromptTokens * 0.15 + totalCompletionTokens * 0.6) / 1_000_000
      const costNtd = Math.round(costUsd * 32 * 10000) / 10000
      await sendSSE({
        type: 'usage',
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        total_tokens: totalTokens,
        estimated_cost_ntd: costNtd,
      })

      if (toolCalls.length > 0) {
        // Save assistant message with tool_calls metadata
        await db.insert(messages).values({
          id: assistantMsgId,
          case_id: caseId,
          role: 'assistant',
          content: fullContent || '',
          metadata: JSON.stringify({ tool_calls: toolCalls }),
          created_at: new Date().toISOString(),
        })

        // Add assistant message to conversation
        chatMessages.push({
          role: 'assistant',
          content: fullContent || '',
          tool_calls: toolCalls,
        })

        // Execute each tool call
        for (const tc of toolCalls) {
          if (signal.aborted) break

          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.function.arguments)
          } catch { /* empty args */ }

          const toolMsgId = nanoid()
          await sendSSE({
            type: 'tool_call_start',
            message_id: toolMsgId,
            tool_name: tc.function.name,
            tool_args: args,
          })

          // Save tool_call record
          await db.insert(messages).values({
            id: toolMsgId,
            case_id: caseId,
            role: 'tool_call',
            content: tc.function.name,
            metadata: JSON.stringify({ tool_call_id: tc.id, args }),
            created_at: new Date().toISOString(),
          })

          // Execute tool
          const { result, success } = await executeTool(
            tc.function.name,
            args,
            caseId,
            this.env.DB,
          )

          // Truncate summary for SSE display
          const resultSummary = result.length > 200
            ? result.slice(0, 200) + '...'
            : result

          await sendSSE({
            type: 'tool_result',
            message_id: toolMsgId,
            tool_name: tc.function.name,
            result_summary: resultSummary,
            success,
          })

          // Save tool_result record
          const toolResultId = nanoid()
          await db.insert(messages).values({
            id: toolResultId,
            case_id: caseId,
            role: 'tool_result',
            content: result,
            metadata: JSON.stringify({ tool_call_id: tc.id, tool_name: tc.function.name, success }),
            created_at: new Date().toISOString(),
          })

          // Add tool result to conversation
          chatMessages.push({
            role: 'tool',
            content: result,
            tool_call_id: tc.id,
          })
        }

        // Continue loop — AI will process tool results
        continue
      }

      // No tool calls → save final assistant message and done
      await db.insert(messages).values({
        id: assistantMsgId,
        case_id: caseId,
        role: 'assistant',
        content: fullContent,
        created_at: new Date().toISOString(),
      })

      break
    }

    await sendSSE({ type: 'done' })
    try { await writer.close() } catch { /* ignore */ }
    this.abortController = null
  }
}
