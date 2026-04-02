// ── Step 2: 法律推理 + 論證策略 (Reasoning + Structuring) ──
// AI reasons freely, calls search_law when it finds gaps, then finalize_strategy to output JSON.

import {
  callClaudeToolLoop,
  extractToolCalls,
  type ClaudeMessage,
  type ClaudeContentBlock,
  type ClaudeToolDefinition,
} from '../claudeClient';
import { callAI } from '../aiClient';
import { createLawSearchSession, type LawSearchSession } from '../../lib/lawSearch';
import {
  buildReasoningSystemPrompt,
  buildReasoningStrategyInput,
} from '../prompts/reasoningStrategyPrompt';
import {
  WRITING_CONVENTIONS,
  MAX_ROUNDS,
  MAX_SEARCHES,
  SOFT_TIMEOUT_MS,
  MAX_TOKENS,
  JSON_OUTPUT_MAX_TOKENS,
  CLAUDE_MODEL,
  getClaimsRules,
  getSectionRules,
  getJsonSchema,
  type PipelineMode,
} from '../prompts/strategyConstants';
import { parseStrategyOutput, validateStrategyOutput } from './validateStrategy';
import { enrichStrategyOutput } from './enrichStrategy';
import { templateToPrompt } from './templateHelper';
import { FALLBACK_GUIDANCE } from '../../lib/defaultTemplates';
import {
  getDamageLabel,
  isItemDamage,
  type ReasoningStrategyInput,
  type ReasoningStrategyOutput,
  type FetchedLaw,
  type PerIssueAnalysis,
  type SectionLawPlanEntry,
  type LegalIssue,
} from './types';
import type { PipelineContext } from './types';
import type { ContextStore } from '../contextStore';

// ── JSON Output System Prompt (separate call, clean context) ──

const buildJsonOutputSystemPrompt = (mode: PipelineMode): string => {
  return `你是一位資深台灣訴訟律師的策略輸出助手。你將收到律師的推理摘要、爭點清單、和可用法條，你的任務是根據這些資料輸出結構化的論證策略 JSON。

${WRITING_CONVENTIONS}

${getClaimsRules(mode)}

${getSectionRules(mode)}

═══ 輸出規則 ═══

- 只輸出 JSON，不要加 markdown code block 或其他文字

${getJsonSchema(mode)}`;
};

/**
 * Build a condensed user message for the separate JSON output call.
 * Includes: reasoning summary, legal issues, available laws, file IDs, brief type.
 */
const buildJsonOutputMessage = (store: ContextStore, input: ReasoningStrategyInput): string => {
  const issueText = store.legalIssues
    .map((issue) => {
      const text = `- [${issue.id}] ${issue.title}\n  我方：${issue.our_position}\n  對方：${issue.their_position}`;
      return text;
    })
    .join('\n');

  // Combine initial fetched laws + supplemented laws (deduplicated)
  const allLawIds = new Set<string>();
  const allLaws: { id: string; name: string }[] = [];
  for (const law of [...input.fetchedLaws, ...store.supplementedLaws]) {
    if (!allLawIds.has(law.id)) {
      allLawIds.add(law.id);
      allLaws.push({ id: law.id, name: `${law.law_name} ${law.article_no}` });
    }
  }

  const lawText = allLaws.map((l) => `- [${l.id}] ${l.name}`).join('\n');

  const fileText = input.fileSummaries.map((f) => `- [${f.id}] ${f.filename}`).join('\n');

  const analysisText =
    store.perIssueAnalysis.length > 0
      ? store.perIssueAnalysis
          .map(
            (a) =>
              `- [${a.issue_id}] 請求權基礎：${a.chosen_basis}\n  法條：${a.key_law_ids.join(', ')}\n  涵攝：${a.element_mapping}${a.defense_response ? `\n  攻防：${a.defense_response}` : ''}`,
          )
          .join('\n')
      : '';

  // Pre-build issue ID → title lookup
  const issueIdToTitle = new Map(store.legalIssues.map((i) => [i.id, i.title]));

  // Build section-level law mapping for prompt (from Claude's reasoning)
  // Falls back to dispute-only mapping if section_law_plan is empty
  const sectionLawMapping =
    store.sectionLawPlan.length > 0
      ? store.sectionLawPlan
          .map(
            (entry) =>
              `  ${entry.label} → [${entry.law_ids.map((id) => `"${id}"`).join(', ')}]（${entry.reason}）`,
          )
          .join('\n')
      : store.perIssueAnalysis
          .map((a) => {
            const label = issueIdToTitle.get(a.issue_id) || a.issue_id;
            return `  ${label}: [${a.key_law_ids.map((id) => `"${id}"`).join(', ')}]`;
          })
          .join('\n');

  // Build damages list for structuring
  const damagesText = store.damages
    .filter(isItemDamage)
    .map((d) => {
      const disputeLabel = d.dispute_id
        ? issueIdToTitle.get(d.dispute_id) || d.dispute_id
        : '不爭執';
      return `  - ${getDamageLabel(d)}：${d.amount.toLocaleString()}元（${disputeLabel}）`;
    })
    .join('\n');

  return `[書狀名稱] ${input.templateTitle || '（未指定範本）'}

[推理摘要]
${store.reasoningSummary || '（無摘要）'}

${analysisText ? `[逐爭點分析]\n${analysisText}\n\n` : ''}[爭點清單]
${issueText}

[損害賠償項目 — 每個項目都必須有獨立 section]
${damagesText || '（無）'}

[可用法條 — 法條 ID 對照表，請從此處精確複製 ID]
${lawText || '（無）'}

[段落→法條分配表 — 每個段落對應的 relevant_law_ids（推理階段決定，請精確複製）]
${sectionLawMapping || '（無）'}

[案件檔案]
${fileText}

[dispute_id 對照表 — 請從此處精確複製 ID，逐字元比對，不要憑記憶拼寫]
${store.legalIssues.map((issue, i) => `  爭點${i + 1}（${issue.title}）: "${issue.id}"`).join('\n')}

請根據以上推理結果，輸出完整的論證策略 JSON（claims + sections）。
- 每個非前言/結論的 section 必須填寫 subsection（格式：一、描述性標題），依序編號（一、二、三…）。前言和結論的 subsection 為 null
- 每個損害賠償項目（含「不爭執」的項目）都必須有獨立的 section，不得省略。不爭執項目的 section 可以較簡短，但仍需有 legal_basis、relevant_file_ids 和 relevant_law_ids
- 每個內容段落（非前言/結論）的 relevant_law_ids 必須從[段落→法條分配表]中找到最匹配的項目並精確複製其法條 ID。前言和結論的 relevant_law_ids 為空陣列 []
- 每個內容段落（非前言/結論）的 relevant_file_ids 必須列出該段撰寫時需要引用的檔案 ID，確保 Writer 能產生引用標記。根據段落主題從[案件檔案]中選擇對應的檔案
- 每個內容段落的 dispute_id 必須從上方對照表原封不動複製，前言和結論為 null
- 每個 claim 的 dispute_id 也必須從上方對照表原封不動複製`;
};

// ── Tool Definitions (Claude format) ──

const SEARCH_LAW_TOOL: ClaudeToolDefinition = {
  name: 'search_law',
  description:
    '搜尋法律條文資料庫。推理過程中主動搜尋你需要引用的法條全文。建議每個請求權基礎至少搜尋一次相關條文。',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          '搜尋關鍵字。格式：「法規名 概念」（中間加空格），例如「民法 過失相抵」「民法 損害賠償」。也支援純概念搜尋如「損害賠償」。',
      },
      law_name: {
        type: 'string',
        description:
          '指定搜尋的法規名稱（如「民法」「刑法」「勞動基準法」），支援縮寫。指定後會在該法規範圍內搜尋。',
      },
      purpose: { type: 'string', description: '為什麼需要搜尋這條法條' },
      limit: { type: 'number', description: '回傳結果數量（預設 3）' },
    },
    required: ['query', 'purpose'],
  },
};

const FINALIZE_STRATEGY_TOOL: ClaudeToolDefinition = {
  name: 'finalize_strategy',
  description:
    '當你完成法律推理、完整性檢查、並補搜完所有需要的法條後，呼叫此工具。需提供整體策略摘要、逐爭點分析、以及每個計畫段落的法條分配。呼叫此工具後，你需要在下一輪輸出完整的 JSON 結果。',
  input_schema: {
    type: 'object',
    properties: {
      reasoning_summary: {
        type: 'string',
        description:
          '整體策略方向摘要（200字以內），如「本案以侵權責任為主，§191-2為核心請求權基礎」',
      },
      per_issue_analysis: {
        type: 'array',
        description: '逐爭點的推理結論，確保 Structuring 階段能精確分配法條和論證策略',
        items: {
          type: 'object',
          properties: {
            issue_id: { type: 'string', description: '對應爭點 ID' },
            chosen_basis: {
              type: 'string',
              description: '選定的請求權基礎，如「民法§184-1前段 + §191-2」',
            },
            key_law_ids: {
              type: 'array',
              items: { type: 'string' },
              description: '本爭點需要的法條 ID（必須是已查到全文的法條）',
            },
            element_mapping: {
              type: 'string',
              description: '構成要件如何對應事實（≤200字）',
            },
            defense_response: {
              type: 'string',
              description: '預判對方抗辯及我方回應策略（≤150字）',
            },
          },
          required: ['issue_id', 'chosen_basis', 'key_law_ids', 'element_mapping'],
        },
      },
      section_law_plan: {
        type: 'array',
        description:
          '每個計畫段落（含非爭點段落）的法條分配。必須涵蓋所有內容段落（侵權行為歸責、每個損害項目、過失相抵等），不只是爭點段落。前言和結論不需要列入。',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: '段落主題（如「侵權行為歸責」「醫療費用」「精神慰撫金」「過失相抵」）',
            },
            law_ids: {
              type: 'array',
              items: { type: 'string' },
              description: '本段應引用的法條 ID（必須是已查到全文的法條）',
            },
            reason: {
              type: 'string',
              description: '簡述為什麼用這些法條（如「主要請求權基礎」「增加生活需要」）',
            },
          },
          required: ['label', 'law_ids', 'reason'],
        },
      },
      supplemented_law_ids: {
        type: 'array',
        items: { type: 'string' },
        description: '推理過程中補搜到的法條 ID 列表',
      },
    },
    required: ['reasoning_summary', 'per_issue_analysis', 'section_law_plan'],
  },
};

const TOOLS = [SEARCH_LAW_TOOL, FINALIZE_STRATEGY_TOOL];

// ── Progress Callback ──

export interface ReasoningStrategyProgressCallback {
  onReasoningStart: () => Promise<void>;
  onSearchLaw: (
    query: string,
    purpose: string,
    resultCount: number,
    lawNames: string[],
  ) => Promise<void>;
  onFinalized: () => Promise<void>;
  onOutputStart: () => Promise<void>;
}

// ── search_law handler ──

const handleSearchLaw = async (
  input: Record<string, unknown>,
  ctx: PipelineContext,
  store: ContextStore,
  lawSession: LawSearchSession,
  searchCount: number,
  progress?: ReasoningStrategyProgressCallback,
): Promise<{ content: string; newCount: number }> => {
  const query = input.query as string;
  const lawName = input.law_name as string | undefined;
  const purpose = input.purpose as string;
  const limit = (input.limit as number) || 3;

  if (searchCount >= MAX_SEARCHES) {
    return {
      content: '已達到搜尋上限。請根據現有法條完成推理並呼叫 finalize_strategy。',
      newCount: searchCount,
    };
  }

  const results = await lawSession.search(query, limit, lawName);
  const newCount = searchCount + 1;

  if (results.length === 0) {
    await progress?.onSearchLaw(query, purpose, 0, []);
    return {
      content: `未找到「${query}」的相關法條。請嘗試用更短的關鍵字，或繼續推理。`,
      newCount,
    };
  }

  // Convert to FetchedLaw and immediately write to ContextStore
  const fetchedLaws: FetchedLaw[] = results.map((r) => ({
    id: r._id,
    law_name: r.law_name,
    article_no: r.article_no,
    content: r.content,
    source: 'supplemented' as const,
  }));
  store.addSupplementedLaws(fetchedLaws);

  // Tool result 回傳完整法條全文（Claude 需要完整內容來精確分配 section_law_plan）
  const resultText = fetchedLaws
    .map((l) => `[${l.id}] ${l.law_name} ${l.article_no}\n${l.content}`)
    .join('\n\n');

  const lawNames = fetchedLaws.map((l) => `${l.law_name} ${l.article_no}`);
  await progress?.onSearchLaw(query, purpose, fetchedLaws.length, lawNames);

  return {
    content: `找到 ${fetchedLaws.length} 筆結果：\n\n${resultText}`,
    newCount,
  };
};

// ── Main Function ──

export const runReasoningStrategy = async (
  ctx: PipelineContext,
  store: ContextStore,
  input: ReasoningStrategyInput,
  progress?: ReasoningStrategyProgressCallback,
  templateContentMd?: string | null,
): Promise<ReasoningStrategyOutput> => {
  await progress?.onReasoningStart();

  const hasTemplate = !!(templateContentMd && templateContentMd.trim());
  const pipelineMode = ctx.pipelineMode;
  const systemPrompt = buildReasoningSystemPrompt(pipelineMode, ctx.briefMode);
  let userMessage = buildReasoningStrategyInput(input, hasTemplate);

  // 注入完整 markdown 範本到 Reasoning prompt
  if (hasTemplate) {
    userMessage += templateToPrompt(templateContentMd!);
  }
  const messages: ClaudeMessage[] = [{ role: 'user', content: userMessage }];

  let finalized = false;
  let timeoutNudged = false;
  let searchCount = 0;
  const startTime = Date.now();
  const lawSession = createLawSearchSession(ctx.mongoUrl, ctx.mongoApiKey);

  // Helper: call Claude with current messages (reasoning phase)
  const callReasoning = () =>
    callClaudeToolLoop(ctx.aiEnv, {
      model: CLAUDE_MODEL,
      system: systemPrompt,
      messages,
      tools: TOOLS,
      max_tokens: MAX_TOKENS,
    });

  // Helper: separate clean call for JSON output (Gemini 2.5 Flash, provider-native constrained decoding)
  // 有 template → 注入完整 markdown 範本；無 template → 注入通用 fallback 指引
  const jsonOutputBase = buildJsonOutputSystemPrompt(pipelineMode);
  const structuringSystemPrompt = hasTemplate
    ? jsonOutputBase + templateToPrompt(templateContentMd!)
    : jsonOutputBase + `\n\n${FALLBACK_GUIDANCE}`;

  const callJsonOutput = (msg: string) =>
    callAI(
      ctx.aiEnv,
      [
        { role: 'system', content: structuringSystemPrompt },
        { role: 'user', content: msg },
      ],
      {
        maxTokens: JSON_OUTPUT_MAX_TOKENS,
        responseFormat: { type: 'json_object' },
      },
    );

  // Token accumulation helper
  const tokenTotals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  const accumulateUsage = (u: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }) => {
    tokenTotals.input += u.input_tokens;
    tokenTotals.output += u.output_tokens;
    tokenTotals.cacheCreation += u.cache_creation_input_tokens ?? 0;
    tokenTotals.cacheRead += u.cache_read_input_tokens ?? 0;
  };

  try {
    // ── Reasoning: 法律推理 tool-loop ──

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await callReasoning();

      accumulateUsage(response.usage);
      const u = response.usage;
      console.log(
        `[reasoning] round ${round}: input=${u.input_tokens}, output=${u.output_tokens}, cache_write=${u.cache_creation_input_tokens ?? 0}, cache_read=${u.cache_read_input_tokens ?? 0}`,
      );

      // Push assistant message (content is ClaudeContentBlock[])
      messages.push({ role: 'assistant', content: response.content });

      // Extract tool calls from response
      const toolCalls = extractToolCalls(response.content);

      // ── No tool calls → end of turn ──
      if (toolCalls.length === 0) {
        if (finalized) break; // Reasoning done, move to Structuring

        // Not finalized → nudge to continue (with timeout override)
        let nudge = '請繼續推理，或如果你已完成推理，請呼叫 finalize_strategy。';
        if (!timeoutNudged && Date.now() - startTime > SOFT_TIMEOUT_MS) {
          timeoutNudged = true;
          nudge =
            '時間有限。如果你的推理已經足夠完整，請立即呼叫 finalize_strategy。' +
            '如果還有關鍵缺口，最多再搜尋一次後就呼叫 finalize_strategy。';
        }
        messages.push({ role: 'user', content: nudge });
        continue;
      }

      // ── Handle tool calls → build tool_result blocks ──
      const resultBlocks: ClaudeContentBlock[] = [];

      for (const tc of toolCalls) {
        if (!['search_law', 'finalize_strategy'].includes(tc.name)) {
          resultBlocks.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `錯誤：工具「${tc.name}」不存在。請只使用 search_law 或 finalize_strategy。`,
          });
          continue;
        }

        if (tc.name === 'search_law') {
          const r = await handleSearchLaw(tc.input, ctx, store, lawSession, searchCount, progress);
          resultBlocks.push({ type: 'tool_result', tool_use_id: tc.id, content: r.content });
          searchCount = r.newCount;
        }

        if (tc.name === 'finalize_strategy') {
          const summary = tc.input.reasoning_summary as string;
          const perIssue = (tc.input.per_issue_analysis as PerIssueAnalysis[]) || [];
          const lawPlan = (tc.input.section_law_plan as SectionLawPlanEntry[]) || [];
          finalized = true;
          store.setReasoningSummary(summary);
          store.setPerIssueAnalysis(perIssue);
          store.setSectionLawPlan(lawPlan);

          resultBlocks.push({ type: 'tool_result', tool_use_id: tc.id, content: '推理完成。' });
          await progress?.onFinalized();
        }
      }

      // Add timeout nudge as text block in the same user message
      if (!timeoutNudged && Date.now() - startTime > SOFT_TIMEOUT_MS && !finalized) {
        timeoutNudged = true;
        resultBlocks.push({
          type: 'text',
          text:
            '時間有限。如果你的推理已經足夠完整，請立即呼叫 finalize_strategy。' +
            '如果還有關鍵缺口，最多再搜尋一次後就呼叫 finalize_strategy。',
        });
      }

      messages.push({ role: 'user', content: resultBlocks });

      // If finalize just happened, break out of loop — don't wait for next round
      if (finalized) break;
    }

    // ── Force finalize if AI hasn't yet ──
    if (!finalized) {
      console.warn('[reasoningStrategy] Reached MAX_ROUNDS without finalize — forcing');

      // Claude requires strict user/assistant alternation.
      // After the loop, last message is always user — append force text to it.
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        if (typeof lastMsg.content === 'string') {
          lastMsg.content += '\n\n你已達到最大輪數。請立即呼叫 finalize_strategy。';
        } else {
          (lastMsg.content as ClaudeContentBlock[]).push({
            type: 'text',
            text: '你已達到最大輪數。請立即呼叫 finalize_strategy。',
          });
        }
      }

      const forceResp = await callReasoning();

      accumulateUsage(forceResp.usage);

      const forceToolCalls = extractToolCalls(forceResp.content);
      for (const tc of forceToolCalls) {
        if (tc.name === 'finalize_strategy') {
          finalized = true;
          store.setReasoningSummary(tc.input.reasoning_summary as string);
          store.setPerIssueAnalysis((tc.input.per_issue_analysis as PerIssueAnalysis[]) || []);
          store.setSectionLawPlan((tc.input.section_law_plan as SectionLawPlanEntry[]) || []);
          await progress?.onFinalized();
        }
      }

      // If AI just output text without tool calls, treat as forced finalize
      if (forceToolCalls.length === 0 && !finalized) {
        finalized = true;
        store.setReasoningSummary('（未提供推理摘要）');
        store.setPerIssueAnalysis([]);
        await progress?.onFinalized();
      }
    }

    // Log cache summary
    console.log(
      `[reasoning] TOTAL: input=${tokenTotals.input}, output=${tokenTotals.output}, cache_write=${tokenTotals.cacheCreation}, cache_read=${tokenTotals.cacheRead}`,
    );
    // ── Structuring: 策略結構化 JSON 輸出 ──
    await progress?.onOutputStart();

    const jsonMessage = buildJsonOutputMessage(store, input);
    return await callJsonAndParse(jsonMessage, store.legalIssues, callJsonOutput);
  } finally {
    await lawSession.close();
  }
};

// ── Parse + Validate + Retry (for separate JSON output call) ──

const tryParse = (text: string): ReasoningStrategyOutput | null => {
  try {
    return parseStrategyOutput(text) as ReasoningStrategyOutput;
  } catch {
    return null;
  }
};

const TRUNCATION_RETRY_SUFFIX = `

重要：你上次的輸出因為過長被截斷，導致 JSON 不完整。請精簡內容：
- argumentation.fact_application 控制在 100 字以內
- argumentation.conclusion 控制在 80 字以內
- legal_reasoning 控制在 150 字以內
- facts_to_use 每個 section 最多 3 項
- claim statement 控制在 80 字以內
確保輸出完整的 JSON。`;

type JsonOutputFn = (
  msg: string,
) => Promise<{ content: string; usage: { output_tokens: number }; truncated: boolean }>;

/** Try parse + fix corrupted dispute_ids in one step, returns null on failure */
const tryParseAndEnrich = (
  text: string,
  legalIssues: LegalIssue[] = [],
): ReasoningStrategyOutput | null => {
  const output = tryParse(text);
  if (!output) return null;
  output.disputeIdFixed = enrichStrategyOutput(output, legalIssues);
  return output;
};

const callJsonAndParse = async (
  userMessage: string,
  legalIssues: ContextStore['legalIssues'],
  callJsonOutput: JsonOutputFn,
): Promise<ReasoningStrategyOutput> => {
  // First attempt
  const resp = await callJsonOutput(userMessage);

  console.log(
    `[reasoningStrategy] JSON output: truncated=${resp.truncated}, output_tokens=${resp.usage.output_tokens}, text_length=${resp.content.length}`,
  );

  let result = tryParseAndEnrich(resp.content, legalIssues);

  // Retry on parse failure
  if (!result) {
    console.warn(`[reasoningStrategy] JSON parse failed, retrying (truncated=${resp.truncated})`);

    const retryMsg = resp.truncated
      ? userMessage + TRUNCATION_RETRY_SUFFIX
      : userMessage +
        '\n\n重要：只輸出純 JSON，不要加 markdown code block、換行解釋或任何其他文字。確保 JSON string 值中沒有未轉義的換行字元。';

    const retryResp = await callJsonOutput(retryMsg);
    result = tryParseAndEnrich(retryResp.content, legalIssues);

    // If retry also truncated and parse still failed, try once more with stronger constraint
    if (!result && retryResp.truncated) {
      console.warn('[reasoningStrategy] Retry also truncated, attempting compact retry');
      const compactMsg =
        userMessage +
        TRUNCATION_RETRY_SUFFIX +
        '\n- 每個 string 欄位盡量精簡，避免冗餘描述\n- 如果有超過 8 個 sections，合併相似段落';
      const compactResp = await callJsonOutput(compactMsg);
      result = tryParseAndEnrich(compactResp.content, legalIssues);
    }

    if (!result) {
      console.error(
        `[reasoningStrategy] All retries failed (first 300 chars): ${resp.content.slice(0, 300)}`,
      );
      throw new Error('論證策略 JSON 解析失敗（重試後仍無法解析）');
    }
  }

  // Validate structure
  const validation = validateStrategyOutput(result, legalIssues);
  if (validation.valid) return result;

  // Retry with validation errors
  console.warn('[reasoningStrategy] Validation failed, retrying:', validation.errors);
  const fixMsg =
    userMessage +
    '\n\n你上次的輸出有以下結構問題，請修正：\n' +
    validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n') +
    '\n\n重要：只輸出純 JSON。';

  const fixResp = await callJsonOutput(fixMsg);

  const fixOutput = tryParseAndEnrich(fixResp.content, legalIssues);
  if (fixOutput) {
    // Re-validate the fix attempt
    const fixValidation = validateStrategyOutput(fixOutput, legalIssues);
    if (fixValidation.valid) return fixOutput;

    // Fix attempt still invalid — fuzzy match may have repaired dispute_ids,
    // so use it if it's better than the original (fewer errors)
    console.warn(
      `[reasoningStrategy] Fix attempt still has ${fixValidation.errors.length} errors (original had ${validation.errors.length})`,
    );
    if (fixValidation.errors.length < validation.errors.length) return fixOutput;
  }

  // Fall back to the original output (fuzzy match may have fixed it)
  return result;
};
