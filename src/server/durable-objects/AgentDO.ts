import { DurableObject } from 'cloudflare:workers';
import { nanoid } from 'nanoid';
import { eq, asc } from 'drizzle-orm';
import { getDB } from '../db';
import { messages } from '../db/schema';
import {
  callAI,
  callAIStreaming,
  type ChatMessage,
  type ToolCall,
  type AIEnv,
} from '../agent/aiClient';
import { TOOL_DEFINITIONS, executeTool } from '../agent/tools';
import { parseOpenAIStream, type OpenAIChunk } from '../agent/sseParser';

const VALID_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));
import type { SSEEvent } from '../../shared/types';

const MAX_ROUNDS = 30;

const SUGGEST_PROMPT = `你是法律助理的建議系統。根據對話上下文，產生 2-3 個使用者可能想做的下一步操作。

直接輸出 JSON array，不要用 markdown code block 包裹，不要加任何其他文字。
格式範例：[{"label":"分析爭點","prompt":"請分析案件爭點"},{"label":"搜尋法條","prompt":"請搜尋相關法條"}]

規則：
- label 最多 4 個中文字
- prompt 是完整的使用者指令
- 根據對話進度建議合理的下一步
- 不要建議使用者已經做過的操作
- 最多 3 個建議`;

const SYSTEM_PROMPT = `你是 LexDraft AI 助理，一位專業的台灣法律分析助手。你的任務是協助律師分析案件卷宗、整理爭點、撰寫法律書狀。

你可以使用以下工具：
- list_files：列出案件所有檔案
- read_file：讀取指定檔案的全文
- create_brief：建立新書狀（取得 brief_id）
- analyze_disputes：分析案件爭點（自動載入所有檔案摘要進行分析）
- calculate_damages：計算各項請求金額明細（自動載入所有檔案摘要分析金額）
- write_brief_section：撰寫或修改書狀段落（使用引用系統，從來源文件中提取精確引用）。提供 paragraph_id 時會修改既有段落，不提供則新增段落。
- search_law：搜尋法規條文（支援法規名稱、條號、法律概念搜尋，結果自動寫入法條引用列表）
- generate_timeline：分析時間軸（自動載入所有檔案摘要，產生時間軸事件列表）

工作流程：
1. 當律師要求分析案件時，先用 list_files 查看有哪些文件
2. 根據需要用 read_file 讀取相關文件
3. 綜合分析後提供專業的法律意見

法條搜尋使用時機（使用 search_law 工具）：
- 當使用者明確要求搜尋法條時（如「查詢民法第184條」「搜尋侵權行為相關法條」「找損害賠償的規定」）
- 當使用者問到法律問題或法規依據時，主動搜尋相關法條
- 撰寫書狀時，針對每個爭點搜尋相關法條以強化論述
- search_law 支援：法規名稱（「民法」）、特定條號（「民法第184條」）、法律概念（「損害賠償」）等搜尋方式
- 搜尋結果會自動顯示在右側「法條引用」面板中

時間軸分析使用時機（使用 generate_timeline 工具）：
- 當使用者要求「分析時間軸」「整理事件經過」「列出時間順序」時
- 結果會顯示在底部「時間軸」分頁中

書狀撰寫流程（收到撰寫書狀指令後，直接執行，不要反問使用者）：
1. 先用 list_files 確認可用的來源檔案
2. 用 read_file 讀取關鍵檔案內容
3. 用 analyze_disputes 分析爭點（如果尚未分析）
4. 用 search_law 搜尋每個爭點相關的法條（加強書狀法律依據），記下回傳結果中方括號內的法條 ID
5. 用 create_brief 建立新書狀 — 自行根據案件性質決定 brief_type 和 title（例如「民事準備書狀」「民事答辯狀」等），不需要詢問使用者
6. 逐段使用 write_brief_section 撰寫書狀，將步驟 4 搜到的法條 ID 傳入 relevant_law_ids 參數，讓法條也能被正確引用
7. 書狀結構參考模板：
   - 壹、前言（案件背景、提出本狀目的）
   - 貳、就被告各項抗辯之反駁（依爭點逐一反駁）
   - 參、請求金額之計算（如適用）
   - 肆、結論

重要：當使用者要求撰寫書狀時，你應該主動完成整個流程，不要中途停下來詢問書狀類型或標題。根據案件卷宗自動判斷最適合的書狀類型和標題。

段落修改規則：
- 當使用者要求修改、改寫、精簡、加強某個既有段落時，必須使用 write_brief_section 並傳入該段落的 paragraph_id
- paragraph_id 可從對話上下文中得知（例如使用者提到「前言」，找到 section 為「壹、前言」的段落 ID）
- 傳入 paragraph_id 時，write_brief_section 會讀取既有段落內容，並在此基礎上進行修改（而非從頭重寫）
- 不傳入 paragraph_id 則為新增段落
- 補充法條引用到既有段落時，「必須」傳入 paragraph_id，否則會變成新增重複段落
- 任何對既有段落的修改操作（補充引用、改寫、精簡等），都必須傳入 paragraph_id

法條引用流程（非常重要，必須嚴格遵守）：
- search_law 只是搜尋法條並顯示在右側面板，它「不會」修改書狀內容
- 要讓法條出現在書狀段落中，必須呼叫 write_brief_section 並傳入 relevant_law_ids
- 補充法條引用的完整流程（缺一不可）：
  Step 1: search_law 搜尋相關法條
  Step 2: 從搜尋結果中記下方括號內的法條 ID（格式如 A0000001-第184條）
  Step 3: 對書狀中每個需要引用的段落呼叫 write_brief_section，帶上 relevant_law_ids 和 relevant_file_ids
  Step 4: 確認所有相關段落都已更新
- 禁止行為：只執行 Step 1-2 而跳過 Step 3-4。搜尋完法條後，你「必須」立即用 write_brief_section 更新段落
- 如果使用者要求「補充法條引用」，你必須：搜尋法條 → 然後對每個段落呼叫 write_brief_section 更新。不可以只搜尋完就結束

引用規則：
- write_brief_section 會自動使用 Claude Citations API 從來源文件和法條提取引用
- 每個段落都應提供 relevant_file_ids，確保引用有據可查
- 同時提供 relevant_law_ids（search_law 回傳的方括號內 ID），讓法條在書狀中產生引用標記
- 如有關聯爭點，應提供 dispute_id

回覆規則：
- 一律使用繁體中文
- 絕對不要使用 emoji 或特殊符號（如 ✅❌🔷📄 等），只用純文字和標點符號
- 引用文件內容時標明出處（檔案名稱）
- 分析要有結構、條理分明
- 如果資訊不足，主動說明需要哪些額外資料
- 列舉項目時使用頓號（、）或數字編號，不要用 emoji 或特殊符號
- 撰寫書狀完成後，只需簡短回覆「已完成書狀撰寫，共 N 個段落」即可，絕對不要在聊天中重複書狀的內容，因為書狀已經即時顯示在右側編輯器中`;

interface Env {
  DB: D1Database;
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
  MONGO_URL: string;
}

export class AgentDO extends DurableObject<Env> {
  private abortController: AbortController | null = null;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/chat') {
      return this.handleChat(request);
    }
    if (request.method === 'POST' && url.pathname === '/cancel') {
      return this.handleCancel();
    }

    return new Response('Not found', { status: 404 });
  }

  private handleCancel(): Response {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleChat(request: Request): Promise<Response> {
    const { message, caseId, briefContext } = (await request.json()) as {
      message: string;
      caseId: string;
      briefContext?: {
        brief_id: string;
        title: string;
        paragraphs: {
          id: string;
          section: string;
          subsection: string;
          content_preview?: string;
        }[];
      };
    };

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sendSSE = async (event: SSEEvent) => {
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } catch {
        // Writer closed, ignore
      }
    };

    // Run agent loop asynchronously
    this.runAgentLoop(caseId, message, signal, sendSSE, writer, briefContext).catch(async (err) => {
      console.error('Agent loop error:', err);
      await sendSSE({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      await sendSSE({ type: 'done' });
      try {
        await writer.close();
      } catch {
        /* ignore */
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  private async runAgentLoop(
    caseId: string,
    userMessage: string,
    signal: AbortSignal,
    sendSSE: (event: SSEEvent) => Promise<void>,
    writer: WritableStreamDefaultWriter,
    briefContext?: {
      brief_id: string;
      title: string;
      paragraphs: {
        id: string;
        section: string;
        subsection: string;
        content_preview?: string;
      }[];
    },
  ) {
    const db = getDB(this.env.DB);
    const aiEnv: AIEnv = {
      CF_ACCOUNT_ID: this.env.CF_ACCOUNT_ID,
      CF_GATEWAY_ID: this.env.CF_GATEWAY_ID,
      CF_AIG_TOKEN: this.env.CF_AIG_TOKEN,
    };

    // 1. Save user message
    const userMsgId = nanoid();
    await db.insert(messages).values({
      id: userMsgId,
      case_id: caseId,
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    });

    // 2. Load conversation history
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.case_id, caseId))
      .orderBy(asc(messages.created_at));

    // 3. Build OpenAI messages format — inject brief context into system prompt
    let systemPrompt = SYSTEM_PROMPT;
    if (briefContext) {
      const paragraphList = briefContext.paragraphs
        .map((p) => {
          const label = `${p.section}${p.subsection ? ' > ' + p.subsection : ''}`;
          const preview = p.content_preview ? ` — "${p.content_preview}..."` : '';
          return `  - [${p.id}] ${label}${preview}`;
        })
        .join('\n');
      systemPrompt += `\n\n--- 當前書狀上下文 ---
使用者正在檢視的書狀：「${briefContext.title}」(brief_id: ${briefContext.brief_id})
段落結構：
${paragraphList}

當使用者要求修改某段落時，直接使用上述 brief_id 和對應的 section/subsection 呼叫 write_brief_section，不需要再詢問使用者。`;
    }
    const chatMessages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    for (const msg of history) {
      if (msg.role === 'user') {
        chatMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const meta = msg.metadata ? JSON.parse(msg.metadata) : null;
        if (meta?.tool_calls) {
          // Filter out corrupted tool calls (e.g. concatenated names from old bug)
          const validToolCalls = (meta.tool_calls as ToolCall[]).filter((tc) =>
            VALID_TOOL_NAMES.has(tc.function.name),
          );
          if (validToolCalls.length > 0) {
            chatMessages.push({
              role: 'assistant',
              content: msg.content || '',
              tool_calls: validToolCalls,
            });
          } else {
            // All tool calls were invalid — add as plain assistant message
            chatMessages.push({
              role: 'assistant',
              content: msg.content || '(tool call skipped)',
            });
          }
        } else {
          chatMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool_result') {
        // Only include tool_result if its tool_call was kept
        const meta = msg.metadata ? JSON.parse(msg.metadata) : null;
        const toolCallId = meta?.tool_call_id || '';
        const hasMatchingCall = chatMessages.some(
          (m) => m.role === 'assistant' && m.tool_calls?.some((tc) => tc.id === toolCallId),
        );
        if (hasMatchingCall) {
          chatMessages.push({
            role: 'tool',
            content: msg.content,
            tool_call_id: toolCallId,
          });
        }
      }
      // Skip tool_call records (they're part of assistant messages)
    }

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // Agent loop
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (signal.aborted) {
        await sendSSE({ type: 'error', message: '已取消' });
        break;
      }

      await sendSSE({
        type: 'progress',
        current: round + 1,
        total: MAX_ROUNDS,
      });

      // Call AI Gateway (streaming)
      const response = await callAIStreaming(aiEnv, {
        messages: chatMessages,
        tools: TOOL_DEFINITIONS,
        signal,
      });

      // Parse streaming response
      const assistantMsgId = nanoid();
      await sendSSE({
        type: 'message_start',
        message_id: assistantMsgId,
        role: 'assistant',
      });

      let fullContent = '';
      const toolCalls: ToolCall[] = [];
      const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();

      await parseOpenAIStream(response, async (chunk: OpenAIChunk) => {
        if (signal.aborted) return;

        // Track usage from final chunk
        if (chunk.usage) {
          totalPromptTokens += chunk.usage.prompt_tokens || 0;
          totalCompletionTokens += chunk.usage.completion_tokens || 0;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;

        // Text content
        if (delta.content) {
          fullContent += delta.content;
          await sendSSE({ type: 'text_delta', delta: delta.content });
        }

        // Tool calls (streamed incrementally)
        // Note: Gemini via CF AI Gateway may repeat full name/args in each chunk
        // rather than streaming incrementally like OpenAI. We handle both cases.
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallBuffers.has(idx)) {
              toolCallBuffers.set(idx, { id: tc.id || '', name: '', args: '' });
            }
            const buf = toolCallBuffers.get(idx)!;
            if (tc.id) buf.id = tc.id;
            if (tc.function?.name) buf.name = tc.function.name;
            if (tc.function?.arguments) {
              // Only append if buffer is not yet valid JSON (handles both
              // incremental streaming and Gemini's repeated-full-args pattern)
              let alreadyValid = false;
              if (buf.args) {
                try {
                  JSON.parse(buf.args);
                  alreadyValid = true;
                } catch {
                  /* not yet valid, keep appending */
                }
              }
              if (!alreadyValid) {
                buf.args += tc.function.arguments;
              }
            }
          }
        }
      });

      await sendSSE({ type: 'message_end', message_id: assistantMsgId });

      // Assemble complete tool calls
      for (const [, buf] of toolCallBuffers) {
        toolCalls.push({
          id: buf.id || `call_${nanoid(8)}`,
          type: 'function',
          function: { name: buf.name, arguments: buf.args || '{}' },
        });
      }

      // Emit usage
      const totalTokens = totalPromptTokens + totalCompletionTokens;
      // Gemini 2.5 Flash pricing: ~$0.15/1M input, ~$0.60/1M output (approximate)
      const costUsd = (totalPromptTokens * 0.15 + totalCompletionTokens * 0.6) / 1_000_000;
      const costNtd = Math.round(costUsd * 32 * 10000) / 10000;
      await sendSSE({
        type: 'usage',
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        total_tokens: totalTokens,
        estimated_cost_ntd: costNtd,
      });

      // Strip U+FFFD replacement characters caused by multi-byte UTF-8 split across chunks
      fullContent = fullContent.replace(/\uFFFD/g, '');

      if (toolCalls.length > 0) {
        // Save assistant message with tool_calls metadata
        await db.insert(messages).values({
          id: assistantMsgId,
          case_id: caseId,
          role: 'assistant',
          content: fullContent || '',
          metadata: JSON.stringify({ tool_calls: toolCalls }),
          created_at: new Date().toISOString(),
        });

        // Add assistant message to conversation
        chatMessages.push({
          role: 'assistant',
          content: fullContent || '',
          tool_calls: toolCalls,
        });

        // Execute each tool call
        for (const tc of toolCalls) {
          if (signal.aborted) break;

          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            /* empty args */
          }

          const toolMsgId = nanoid();
          await sendSSE({
            type: 'tool_call_start',
            message_id: toolMsgId,
            tool_name: tc.function.name,
            tool_args: args,
          });

          // Save tool_call record
          await db.insert(messages).values({
            id: toolMsgId,
            case_id: caseId,
            role: 'tool_call',
            content: tc.function.name,
            metadata: JSON.stringify({ tool_call_id: tc.id, args }),
            created_at: new Date().toISOString(),
          });

          // Execute tool
          const { result, success } = await executeTool(
            tc.function.name,
            args,
            caseId,
            this.env.DB,
            {
              sendSSE,
              aiEnv,
              mongoUrl: this.env.MONGO_URL,
            },
          );

          // Truncate summary for SSE display
          const resultSummary = result.length > 200 ? result.slice(0, 200) + '...' : result;

          await sendSSE({
            type: 'tool_result',
            message_id: toolMsgId,
            tool_name: tc.function.name,
            result_summary: resultSummary,
            success,
          });

          // Save tool_result record
          const toolResultId = nanoid();
          await db.insert(messages).values({
            id: toolResultId,
            case_id: caseId,
            role: 'tool_result',
            content: result,
            metadata: JSON.stringify({
              tool_call_id: tc.id,
              tool_name: tc.function.name,
              success,
            }),
            created_at: new Date().toISOString(),
          });

          // Add tool result to conversation
          chatMessages.push({
            role: 'tool',
            content: result,
            tool_call_id: tc.id,
          });
        }

        // Continue loop — AI will process tool results
        continue;
      }

      // No tool calls → save final assistant message and done
      await db.insert(messages).values({
        id: assistantMsgId,
        case_id: caseId,
        role: 'assistant',
        content: fullContent,
        created_at: new Date().toISOString(),
      });

      // Generate suggested actions
      try {
        const recentMessages = chatMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-6);
        const suggestResult = await callAI(aiEnv, [
          { role: 'system', content: SUGGEST_PROMPT },
          ...recentMessages,
        ]);
        // Try direct parse, fallback to extracting from markdown code block
        let raw = suggestResult.content.trim();
        const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) raw = codeBlockMatch[1].trim();
        const actions = JSON.parse(raw) as {
          label: string;
          prompt: string;
        }[];
        if (Array.isArray(actions) && actions.length > 0) {
          await sendSSE({
            type: 'suggested_actions',
            actions: actions.slice(0, 3),
          });
        }
      } catch (err) {
        console.error('Suggested actions generation failed:', err);
      }

      break;
    }

    await sendSSE({ type: 'done' });
    try {
      await writer.close();
    } catch {
      /* ignore */
    }
    this.abortController = null;
  }
}
