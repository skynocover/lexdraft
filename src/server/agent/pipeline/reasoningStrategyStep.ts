// ── Step 2: 法律推理 + 論證策略 (Claude tool-loop agent) ──
// AI reasons freely, calls search_law when it finds gaps, then finalize_strategy to output JSON.

import {
  callClaude,
  callClaudeToolLoop,
  extractToolCalls,
  type ClaudeContentBlock,
  type ClaudeMessage,
  type ClaudeToolDefinition,
  type ClaudeUsage,
} from '../claudeClient';
import { createLawSearchSession, type LawSearchSession } from '../../lib/lawSearch';
import { upsertManyLawRefs } from '../../lib/lawRefsJson';
import type { LawRefItem } from '../../lib/lawRefsJson';
import {
  REASONING_STRATEGY_SYSTEM_PROMPT,
  buildReasoningStrategyInput,
} from '../prompts/reasoningStrategyPrompt';
import {
  BRIEF_STRUCTURE_CONVENTIONS,
  CLAIMS_RULES,
  SECTION_RULES,
  STRATEGY_JSON_SCHEMA,
} from '../prompts/strategyConstants';
import { parseStrategyOutput, validateStrategyOutput } from './validateStrategy';
import { jsonrepair } from 'jsonrepair';
import type { ReasoningStrategyInput, ReasoningStrategyOutput, FetchedLaw } from './types';
import type { PipelineContext } from '../briefPipeline';
import type { ContextStore } from '../contextStore';

// ── Constants ──

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_ROUNDS = 6;
const MAX_SEARCHES = 6;
const SOFT_TIMEOUT_MS = 25000;
const MAX_TOKENS = 16384;
const JSON_OUTPUT_MAX_TOKENS = 32768;

// ── JSON Output System Prompt (separate call, clean context) ──

const JSON_OUTPUT_SYSTEM_PROMPT = `你是一位資深台灣訴訟律師的策略輸出助手。你將收到律師的推理摘要、爭點清單、和可用法條，你的任務是根據這些資料輸出結構化的論證策略 JSON。

${BRIEF_STRUCTURE_CONVENTIONS}

${CLAIMS_RULES}

${SECTION_RULES}

═══ 輸出規則 ═══

- 只輸出 JSON，不要加 markdown code block 或其他文字

${STRATEGY_JSON_SCHEMA}`;

/**
 * Build a condensed user message for the separate JSON output call.
 * Includes: reasoning summary, legal issues, available laws, file IDs, brief type.
 */
const buildJsonOutputMessage = (store: ContextStore, input: ReasoningStrategyInput): string => {
  const issueText = store.legalIssues
    .map((issue) => {
      let text = `- [${issue.id}] ${issue.title}\n  我方：${issue.our_position}\n  對方：${issue.their_position}`;
      if (issue.facts && issue.facts.length > 0) {
        for (const fact of issue.facts) {
          text += `\n  事實：[${fact.id}] ${fact.description}（${fact.assertion_type}）`;
        }
      }
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

  return `[書狀類型] ${input.briefType}

[推理摘要]
${store.reasoningSummary || '（無摘要）'}

[爭點清單]
${issueText}

[可用法條]
${lawText || '（無）'}

[案件檔案]
${fileText}

請根據以上推理結果，輸出完整的論證策略 JSON（claims + sections）。`;
};

// ── Tool Definitions ──

const SEARCH_LAW_TOOL: ClaudeToolDefinition = {
  name: 'search_law',
  description: '搜尋法律條文資料庫。用於推理過程中發現缺口時補搜法條。',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          '搜尋關鍵字。格式：「法規名 概念」（中間加空格），例如「民法 過失相抵」「民法 損害賠償」。避免不帶法規名的純概念搜尋。',
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
    '當你完成法律推理、補搜完所有需要的法條後，呼叫此工具來輸出最終的論證策略。呼叫此工具後，你需要在下一輪輸出完整的 JSON 結果。',
  input_schema: {
    type: 'object',
    properties: {
      reasoning_summary: {
        type: 'string',
        description: '推理過程的摘要（500字以內）',
      },
      supplemented_law_ids: {
        type: 'array',
        items: { type: 'string' },
        description: '推理過程中補搜到的法條 ID 列表',
      },
    },
    required: ['reasoning_summary'],
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
  toolId: string,
  input: Record<string, unknown>,
  ctx: PipelineContext,
  store: ContextStore,
  lawSession: LawSearchSession,
  searchCount: number,
  progress?: ReasoningStrategyProgressCallback,
): Promise<{ result: ClaudeContentBlock; newCount: number }> => {
  const query = input.query as string;
  const purpose = input.purpose as string;
  const limit = (input.limit as number) || 3;

  if (searchCount >= MAX_SEARCHES) {
    return {
      result: {
        type: 'tool_result',
        tool_use_id: toolId,
        content: '已達到搜尋上限。請根據現有法條完成推理並呼叫 finalize_strategy。',
      },
      newCount: searchCount,
    };
  }

  const results = await lawSession.search(query, limit);
  const newCount = searchCount + 1;

  if (results.length === 0) {
    await progress?.onSearchLaw(query, purpose, 0, []);
    return {
      result: {
        type: 'tool_result',
        tool_use_id: toolId,
        content: `未找到「${query}」的相關法條。請嘗試用更短的關鍵字，或繼續推理。`,
      },
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

  // Persist to DB immediately (fire and forget for speed)
  const lawRefs: LawRefItem[] = fetchedLaws.map((l) => ({
    id: l.id,
    law_name: l.law_name,
    article: l.article_no,
    full_text: l.content,
    is_manual: false,
  }));
  upsertManyLawRefs(ctx.drizzle, ctx.caseId, lawRefs).catch((err) =>
    console.error('[reasoningStrategy] Failed to persist law refs:', err),
  );

  const resultText = fetchedLaws
    .map((l) => `[${l.id}] ${l.law_name} ${l.article_no}\n${l.content}`)
    .join('\n\n');

  const lawNames = fetchedLaws.map((l) => `${l.law_name} ${l.article_no}`);
  await progress?.onSearchLaw(query, purpose, fetchedLaws.length, lawNames);

  return {
    result: {
      type: 'tool_result',
      tool_use_id: toolId,
      content: `找到 ${fetchedLaws.length} 筆結果：\n\n${resultText}`,
    },
    newCount,
  };
};

// ── Main Function ──

export const runReasoningStrategy = async (
  ctx: PipelineContext,
  store: ContextStore,
  input: ReasoningStrategyInput,
  usage: ClaudeUsage,
  progress?: ReasoningStrategyProgressCallback,
): Promise<ReasoningStrategyOutput> => {
  await progress?.onReasoningStart();

  const userMessage = buildReasoningStrategyInput(input);
  const messages: ClaudeMessage[] = [{ role: 'user', content: userMessage }];

  let finalized = false;
  let timeoutNudged = false;
  let searchCount = 0;
  const startTime = Date.now();
  const lawSession = createLawSearchSession(ctx.mongoUrl);

  // Helper: call Claude with current messages (reasoning phase)
  const callReasoning = () =>
    callClaudeToolLoop(ctx.aiEnv, {
      model: MODEL,
      system: REASONING_STRATEGY_SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      max_tokens: MAX_TOKENS,
    });

  // Helper: separate clean call for JSON output (simpler callClaude, no tool overhead)
  const callJsonOutput = (userMessage: string) =>
    callClaude(ctx.aiEnv, JSON_OUTPUT_SYSTEM_PROMPT, userMessage, JSON_OUTPUT_MAX_TOKENS);

  // Helper: accumulate usage
  const addUsage = (u: ClaudeUsage) => {
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
  };

  try {
    // ── Phase 1: Reasoning tool-loop ──
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // Soft timeout nudge (only once)
      if (!timeoutNudged && Date.now() - startTime > SOFT_TIMEOUT_MS && !finalized) {
        timeoutNudged = true;
        messages.push({
          role: 'user',
          content:
            '時間有限。如果你的推理已經足夠完整，請立即呼叫 finalize_strategy。' +
            '如果還有關鍵缺口，最多再搜尋一次後就呼叫 finalize_strategy。',
        });
      }

      const response = await callReasoning();
      addUsage(response.usage);
      messages.push({ role: 'assistant', content: response.content });

      const toolCalls = extractToolCalls(response.content);

      // ── end_turn with no tool calls ──
      if (response.stop_reason === 'end_turn' && toolCalls.length === 0) {
        if (finalized) break; // Reasoning done, move to Phase 2
        // Not finalized → nudge to continue
        messages.push({
          role: 'user',
          content: '請繼續推理，或如果你已完成推理，請呼叫 finalize_strategy。',
        });
        continue;
      }

      // ── Handle tool calls ──
      if (toolCalls.length > 0) {
        const toolResults: ClaudeContentBlock[] = [];

        for (const tc of toolCalls) {
          if (!['search_law', 'finalize_strategy'].includes(tc.name)) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `錯誤：工具「${tc.name}」不存在。請只使用 search_law 或 finalize_strategy。`,
            });
            continue;
          }

          if (tc.name === 'search_law') {
            const r = await handleSearchLaw(
              tc.id,
              tc.input,
              ctx,
              store,
              lawSession,
              searchCount,
              progress,
            );
            toolResults.push(r.result);
            searchCount = r.newCount;
          }

          if (tc.name === 'finalize_strategy') {
            const summary = tc.input.reasoning_summary as string;
            finalized = true;
            store.setReasoningSummary(summary);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: '推理完成。',
            });
            await progress?.onFinalized();
          }
        }

        messages.push({ role: 'user', content: toolResults });

        // If finalize just happened, break out of loop — don't wait for next round
        if (finalized) break;
      }
    }

    // ── Force finalize if AI hasn't yet ──
    if (!finalized) {
      console.warn('[reasoningStrategy] Reached MAX_ROUNDS without finalize — forcing');
      messages.push({
        role: 'user',
        content: '你已達到最大輪數。請立即呼叫 finalize_strategy。',
      });

      const forceResp = await callReasoning();
      addUsage(forceResp.usage);

      const forceTCs = extractToolCalls(forceResp.content);

      for (const tc of forceTCs) {
        if (tc.name === 'finalize_strategy') {
          finalized = true;
          store.setReasoningSummary(tc.input.reasoning_summary as string);
          await progress?.onFinalized();
        }
      }

      // If AI just output text without tool calls, treat as forced finalize
      if (forceTCs.length === 0 && !finalized) {
        finalized = true;
        store.setReasoningSummary('（未提供推理摘要）');
        await progress?.onFinalized();
      }
    }

    // ── Phase 2: Separate JSON output call (clean context, no tools) ──
    await progress?.onOutputStart();

    const jsonMessage = buildJsonOutputMessage(store, input);
    return await callJsonAndParse(jsonMessage, store, input, callJsonOutput, addUsage);
  } finally {
    await lawSession.close();
  }
};

// ── Parse + Validate + Retry (for separate JSON output call) ──

const tryParse = (text: string): ReasoningStrategyOutput | null => {
  // First try normal parse (handles markdown blocks, trailing commas, balanced brace extraction)
  try {
    return parseStrategyOutput(text) as ReasoningStrategyOutput;
  } catch {
    // noop
  }

  // Use jsonrepair to fix all common LLM JSON issues:
  // missing quotes, unescaped control chars, truncated JSON, single quotes, etc.
  try {
    const repaired = jsonrepair(text);
    return parseStrategyOutput(repaired) as ReasoningStrategyOutput;
  } catch {
    // noop
  }

  return null;
};

const callJsonAndParse = async (
  userMessage: string,
  store: ContextStore,
  input: ReasoningStrategyInput,
  callJsonOutput: (msg: string) => ReturnType<typeof callClaude>,
  addUsage: (u: ClaudeUsage) => void,
): Promise<ReasoningStrategyOutput> => {
  // First attempt
  const resp = await callJsonOutput(userMessage);
  addUsage(resp.usage);

  console.log(
    `[reasoningStrategy] JSON output: truncated=${resp.truncated}, output_tokens=${resp.usage.output_tokens}, text_length=${resp.content.length}`,
  );

  if (resp.truncated) {
    console.warn(
      `[reasoningStrategy] JSON output truncated! output_tokens=${resp.usage.output_tokens}`,
    );
  }

  let output = tryParse(resp.content);

  // Retry on parse failure
  if (!output) {
    console.warn(
      `[reasoningStrategy] JSON output parse failed (first 300 chars): ${resp.content.slice(0, 300)}`,
    );
    const retryMsg =
      buildJsonOutputMessage(store, input) +
      '\n\n重要：只輸出純 JSON，不要加 markdown code block、換行解釋或任何其他文字。確保 JSON string 值中沒有未轉義的換行字元。';
    const retryResp = await callJsonOutput(retryMsg);
    addUsage(retryResp.usage);

    output = tryParse(retryResp.content);

    if (!output) {
      console.error(
        `[reasoningStrategy] Retry also failed (first 300 chars): ${retryResp.content.slice(0, 300)}`,
      );
      throw new Error('論證策略 JSON 解析失敗（重試後仍無法解析）');
    }
  }

  // Validate structure
  const validation = validateStrategyOutput(output, store.legalIssues);
  if (validation.valid) return output;

  // Retry with validation errors
  console.warn('[reasoningStrategy] Validation failed, retrying:', validation.errors);
  const fixMsg =
    buildJsonOutputMessage(store, input) +
    '\n\n你上次的輸出有以下結構問題，請修正：\n' +
    validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n') +
    '\n\n重要：只輸出純 JSON。';

  const fixResp = await callJsonOutput(fixMsg);
  addUsage(fixResp.usage);

  const fixOutput = tryParse(fixResp.content);

  return fixOutput || output;
};
