// ── Step 2: 法律推理 + 論證策略 (Reasoning + Structuring) ──
// AI reasons freely, calls search_law when it finds gaps, then finalize_strategy to output JSON.

import {
  callClaudeToolLoop,
  extractToolCalls,
  type ClaudeMessage,
  type ClaudeContentBlock,
  type ClaudeToolDefinition,
} from '../claudeClient';
import { callGeminiNative } from '../aiClient';
import { createLawSearchSession, type LawSearchSession } from '../../lib/lawSearch';
import { upsertManyLawRefs } from '../../lib/lawRefsJson';
import type { LawRefItem } from '../../lib/lawRefsJson';
import {
  REASONING_STRATEGY_SYSTEM_PROMPT,
  buildReasoningStrategyInput,
} from '../prompts/reasoningStrategyPrompt';
import {
  WRITING_CONVENTIONS,
  getStructureGuidance,
  CLAIMS_RULES,
  SECTION_RULES,
  STRATEGY_JSON_SCHEMA,
  MAX_ROUNDS,
  MAX_SEARCHES,
  SOFT_TIMEOUT_MS,
  MAX_TOKENS,
  JSON_OUTPUT_MAX_TOKENS,
  CLAUDE_MODEL,
} from '../prompts/strategyConstants';
import { parseStrategyOutput, validateStrategyOutput } from './validateStrategy';
import { templateToPrompt } from './templateHelper';
import type {
  ReasoningStrategyInput,
  ReasoningStrategyOutput,
  FetchedLaw,
  PerIssueAnalysis,
  LegalIssue,
} from './types';
import type { PipelineContext } from './types';
import type { ContextStore } from '../contextStore';

// ── JSON Output System Prompt (separate call, clean context) ──

const JSON_OUTPUT_SYSTEM_PROMPT = `你是一位資深台灣訴訟律師的策略輸出助手。你將收到律師的推理摘要、爭點清單、和可用法條，你的任務是根據這些資料輸出結構化的論證策略 JSON。

${WRITING_CONVENTIONS}

${CLAIMS_RULES}

${SECTION_RULES}

═══ 輸出規則 ═══

- 只輸出 JSON，不要加 markdown code block 或其他文字

${STRATEGY_JSON_SCHEMA}`;

// ── Gemini responseSchema (OpenAPI format, constrained decoding) ──
// Mirrors Claim, StrategySection, ArgumentationFramework, FactUsage in ./types.ts.
// Keep in sync when modifying the TypeScript interfaces.

const STRATEGY_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          side: { type: 'STRING', enum: ['ours', 'theirs'] },
          claim_type: { type: 'STRING', enum: ['primary', 'rebuttal', 'supporting'] },
          statement: { type: 'STRING' },
          assigned_section: { type: 'STRING', nullable: true },
          dispute_id: { type: 'STRING', nullable: true },
          responds_to: { type: 'STRING', nullable: true },
        },
        required: [
          'id',
          'side',
          'claim_type',
          'statement',
          'assigned_section',
          'dispute_id',
          'responds_to',
        ],
      },
    },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          section: { type: 'STRING' },
          subsection: { type: 'STRING', nullable: true },
          dispute_id: { type: 'STRING', nullable: true },
          argumentation: {
            type: 'OBJECT',
            properties: {
              legal_basis: { type: 'ARRAY', items: { type: 'STRING' } },
              fact_application: { type: 'STRING' },
              conclusion: { type: 'STRING' },
            },
            required: ['legal_basis', 'fact_application', 'conclusion'],
          },
          claims: { type: 'ARRAY', items: { type: 'STRING' } },
          relevant_file_ids: { type: 'ARRAY', items: { type: 'STRING' } },
          facts_to_use: {
            type: 'ARRAY',
            nullable: true,
            items: {
              type: 'OBJECT',
              properties: {
                fact_id: { type: 'STRING' },
                assertion_type: { type: 'STRING' },
                usage: { type: 'STRING' },
              },
              required: ['fact_id', 'assertion_type', 'usage'],
            },
          },
          legal_reasoning: { type: 'STRING', nullable: true },
        },
        required: ['id', 'section', 'argumentation', 'claims', 'relevant_file_ids'],
      },
    },
  },
  required: ['claims', 'sections'],
};

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

  const analysisText =
    store.perIssueAnalysis.length > 0
      ? store.perIssueAnalysis
          .map(
            (a) =>
              `- [${a.issue_id}] 請求權基礎：${a.chosen_basis}\n  法條：${a.key_law_ids.join(', ')}\n  涵攝：${a.element_mapping}${a.defense_response ? `\n  攻防：${a.defense_response}` : ''}`,
          )
          .join('\n')
      : '';

  return `[書狀類型] ${input.briefType}

[推理摘要]
${store.reasoningSummary || '（無摘要）'}

${analysisText ? `[逐爭點分析]\n${analysisText}\n\n` : ''}[爭點清單]
${issueText}

[可用法條]
${lawText || '（無）'}

[案件檔案]
${fileText}

[dispute_id 對照表 — 請從此處精確複製 ID，逐字元比對，不要憑記憶拼寫]
${store.legalIssues.map((issue, i) => `  爭點${i + 1}（${issue.title}）: "${issue.id}"`).join('\n')}

請根據以上推理結果，輸出完整的論證策略 JSON（claims + sections）。
- 每個非前言/結論的 section 必須填寫 subsection（格式：一、描述性標題），依序編號（一、二、三…）。前言和結論的 subsection 為 null
- 每個 section 的 relevant_law_ids 應依照[逐爭點分析]中各爭點的 key_law_ids 分配
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
    '當你完成法律推理、完整性檢查、並補搜完所有需要的法條後，呼叫此工具。需提供整體策略摘要和逐爭點分析（請求權基礎、法條、涵攝、攻防）。呼叫此工具後，你需要在下一輪輸出完整的 JSON 結果。',
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
      supplemented_law_ids: {
        type: 'array',
        items: { type: 'string' },
        description: '推理過程中補搜到的法條 ID 列表',
      },
    },
    required: ['reasoning_summary', 'per_issue_analysis'],
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
  const systemPrompt = REASONING_STRATEGY_SYSTEM_PROMPT;
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
  // 有 template → 注入完整 markdown 範本；無 template → 注入 briefType fallback 結構
  const structuringSystemPrompt = hasTemplate
    ? JSON_OUTPUT_SYSTEM_PROMPT + templateToPrompt(templateContentMd!)
    : JSON_OUTPUT_SYSTEM_PROMPT + getStructureGuidance(input.briefType, false);

  const callJsonOutput = (msg: string) =>
    callGeminiNative(ctx.aiEnv, structuringSystemPrompt, msg, {
      maxTokens: JSON_OUTPUT_MAX_TOKENS,
      responseSchema: STRATEGY_RESPONSE_SCHEMA,
    });

  try {
    // ── Reasoning: 法律推理 tool-loop ──
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await callReasoning();

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
          finalized = true;
          store.setReasoningSummary(summary);
          store.setPerIssueAnalysis(perIssue);

          console.log(
            `[reasoning] finalized: ${perIssue.length} issues, key_law_ids=[${perIssue.flatMap((a) => a.key_law_ids).join(', ')}]`,
          );

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

      const forceToolCalls = extractToolCalls(forceResp.content);
      for (const tc of forceToolCalls) {
        if (tc.name === 'finalize_strategy') {
          finalized = true;
          store.setReasoningSummary(tc.input.reasoning_summary as string);
          store.setPerIssueAnalysis((tc.input.per_issue_analysis as PerIssueAnalysis[]) || []);
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

    // ── Structuring: 策略結構化 JSON 輸出 ──
    await progress?.onOutputStart();

    const jsonMessage = buildJsonOutputMessage(store, input);
    return await callJsonAndParse(
      jsonMessage,
      store.legalIssues,
      store.perIssueAnalysis,
      callJsonOutput,
    );
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

// ── Programmatic Enrichment (補齊 AI 偷懶填空的欄位) ──

const CHINESE_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/**
 * Levenshtein distance between two strings.
 * Used to fuzzy-match corrupted dispute_ids from Gemini output.
 */
const levenshtein = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

/**
 * Try to find the closest valid issue ID for a corrupted dispute_id.
 * Returns the match if Levenshtein distance ≤ 3 (nanoid is 21 chars, so 3 edits is ~14% error).
 */
const fuzzyMatchDisputeId = (corrupted: string, validIds: Set<string>): string | null => {
  if (validIds.has(corrupted)) return null; // already valid

  // Strip whitespace that Gemini sometimes inserts
  const stripped = corrupted.replace(/\s/g, '');
  if (validIds.has(stripped)) return stripped;

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const id of validIds) {
    const dist = levenshtein(stripped, id);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  return bestDist <= 3 ? bestId : null;
};

/** Fix corrupted dispute_ids in an array of items (sections or claims). Returns count of fixes. */
const fixCorruptedDisputeIds = (
  items: Array<{ dispute_id?: string | null }>,
  validIds: Set<string>,
  label: string,
): number => {
  let fixed = 0;
  for (const item of items) {
    if (item.dispute_id && !validIds.has(item.dispute_id)) {
      const match = fuzzyMatchDisputeId(item.dispute_id, validIds);
      if (match) {
        console.warn(`[enrichment] fixed ${label} dispute_id: "${item.dispute_id}" → "${match}"`);
        item.dispute_id = match;
        fixed++;
      }
    }
  }
  return fixed;
};

const enrichStrategyOutput = (
  output: ReasoningStrategyOutput,
  perIssueAnalysis: PerIssueAnalysis[],
  legalIssues: LegalIssue[] = [],
): void => {
  const { claims, sections } = output;
  const stats = {
    disputeIdFixed: 0,
    sectionDisputeFromClaim: 0,
    claimDisputeFromSection: 0,
    claimConsistency: 0,
    legalBasis: 0,
    lawIds: 0,
    subsection: 0,
  };

  // 0. 修正 corrupted dispute_id（Gemini 經常抄錯 nanoid）
  if (legalIssues.length > 0) {
    const validIds = new Set(legalIssues.map((i) => i.id));
    stats.disputeIdFixed += fixCorruptedDisputeIds(sections, validIds, 'section');
    stats.disputeIdFixed += fixCorruptedDisputeIds(claims, validIds, 'claim');
  }

  // 1. 修正 section dispute_id — 從其 claims 推導
  for (const sec of sections) {
    if (!sec.dispute_id && sec.claims.length > 0) {
      const sectionClaimIds = new Set(sec.claims);
      const disputeIds = new Set(
        claims.filter((c) => sectionClaimIds.has(c.id) && c.dispute_id).map((c) => c.dispute_id!),
      );
      if (disputeIds.size === 1) {
        sec.dispute_id = [...disputeIds][0];
        stats.sectionDisputeFromClaim++;
      }
    }
  }

  // 2. 修正 claim dispute_id — 從其 assigned_section 的 section 取
  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  for (const claim of claims) {
    if (!claim.dispute_id && claim.assigned_section) {
      const sec = sectionMap.get(claim.assigned_section);
      if (sec?.dispute_id) {
        claim.dispute_id = sec.dispute_id;
        stats.claimDisputeFromSection++;
      }
    }
  }

  // 3. 修正 section claims[] 一致性 — claim.assigned_section 指向 section 但 section.claims 沒有它
  for (const claim of claims) {
    if (claim.assigned_section) {
      const sec = sectionMap.get(claim.assigned_section);
      if (sec && !sec.claims.includes(claim.id)) {
        sec.claims.push(claim.id);
        stats.claimConsistency++;
      }
    }
  }

  // 4. 填 argumentation.legal_basis（如果空且有 dispute_id）
  const analysisMap = new Map(perIssueAnalysis.map((a) => [a.issue_id, a]));
  for (const sec of sections) {
    if (sec.dispute_id && sec.argumentation.legal_basis.length === 0) {
      const analysis = analysisMap.get(sec.dispute_id);
      if (analysis && analysis.key_law_ids.length > 0) {
        sec.argumentation.legal_basis = [...analysis.key_law_ids];
        stats.legalBasis++;
      }
    }
  }

  // 5. 填 relevant_law_ids（最後做，依賴 dispute_id 和 legal_basis）
  for (const sec of sections) {
    sec.relevant_law_ids = sec.relevant_law_ids || [];
    if (!sec.dispute_id) continue;

    const analysis = analysisMap.get(sec.dispute_id);
    const fromAnalysis = analysis?.key_law_ids || [];
    const fromBasis = sec.argumentation.legal_basis || [];

    const before = sec.relevant_law_ids.length;
    const merged = new Set([...sec.relevant_law_ids, ...fromAnalysis, ...fromBasis]);
    sec.relevant_law_ids = [...merged];
    if (sec.relevant_law_ids.length > before) stats.lawIds++;
  }

  // 6. 填 subsection（有 dispute_id 但沒 subsection 的段落，從爭點標題推導）
  if (legalIssues.length > 0) {
    const issueMap = new Map(legalIssues.map((i) => [i.id, i]));
    // Group sections by parent section name to assign numbering
    const parentCounters: Record<string, number> = {};

    for (const sec of sections) {
      if (sec.subsection || !sec.dispute_id) continue;

      const issue = issueMap.get(sec.dispute_id);
      if (!issue) continue;

      const parent = sec.section;
      const idx = parentCounters[parent] || 0;
      const num = CHINESE_NUMS[idx] || `${idx + 1}`;

      // Truncate dispute title to keep subsection concise (max 15 chars)
      const title = issue.title.length > 15 ? issue.title.slice(0, 15) : issue.title;
      sec.subsection = `${num}、${title}`;
      parentCounters[parent] = idx + 1;
      stats.subsection++;
    }
  }

  // Summary log
  const enrichedCount = sections.filter((s) => s.relevant_law_ids.length > 0).length;
  const totalLawIds = sections.reduce((sum, s) => sum + s.relevant_law_ids.length, 0);
  const totalPatched = Object.values(stats).reduce((a, b) => a + b, 0);

  console.log(
    `[enrichment] ${totalPatched} patches applied — ` +
      `dispute_id_fixed: ${stats.disputeIdFixed}, ` +
      `sec.dispute_id←claim: ${stats.sectionDisputeFromClaim}, ` +
      `claim.dispute_id←sec: ${stats.claimDisputeFromSection}, ` +
      `claim↔sec consistency: ${stats.claimConsistency}, ` +
      `legal_basis: ${stats.legalBasis}, ` +
      `law_ids: ${stats.lawIds}, ` +
      `subsection: ${stats.subsection}`,
  );
  console.log(
    `[enrichment] result: ${enrichedCount}/${sections.length} sections have law_ids (${totalLawIds} total)`,
  );

  // Per-section detail for debugging
  for (const sec of sections) {
    const label = sec.subsection ? `${sec.section} > ${sec.subsection}` : sec.section;
    console.log(
      `[enrichment]   "${label}" dispute=${sec.dispute_id || 'null'} ` +
        `laws=[${sec.relevant_law_ids.join(', ')}] ` +
        `basis=[${sec.argumentation.legal_basis.join(', ')}]`,
    );
  }

  if (totalPatched > sections.length) {
    console.warn(
      `[enrichment] WARNING: ${totalPatched} patches for ${sections.length} sections — AI output quality may be degrading`,
    );
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

/** Try parse + enrich in one step, returns null on failure */
const tryParseAndEnrich = (
  text: string,
  perIssueAnalysis: PerIssueAnalysis[],
  legalIssues: LegalIssue[] = [],
): ReasoningStrategyOutput | null => {
  const output = tryParse(text);
  if (output) enrichStrategyOutput(output, perIssueAnalysis, legalIssues);
  return output;
};

const callJsonAndParse = async (
  userMessage: string,
  legalIssues: ContextStore['legalIssues'],
  perIssueAnalysis: PerIssueAnalysis[],
  callJsonOutput: JsonOutputFn,
): Promise<ReasoningStrategyOutput> => {
  // First attempt
  const resp = await callJsonOutput(userMessage);

  console.log(
    `[reasoningStrategy] JSON output: truncated=${resp.truncated}, output_tokens=${resp.usage.output_tokens}, text_length=${resp.content.length}`,
  );

  let output = tryParseAndEnrich(resp.content, perIssueAnalysis, legalIssues);

  // Retry on parse failure
  if (!output) {
    console.warn(`[reasoningStrategy] JSON parse failed, retrying (truncated=${resp.truncated})`);

    const retryMsg = resp.truncated
      ? userMessage + TRUNCATION_RETRY_SUFFIX
      : userMessage +
        '\n\n重要：只輸出純 JSON，不要加 markdown code block、換行解釋或任何其他文字。確保 JSON string 值中沒有未轉義的換行字元。';

    const retryResp = await callJsonOutput(retryMsg);
    output = tryParseAndEnrich(retryResp.content, perIssueAnalysis, legalIssues);

    // If retry also truncated and parse still failed, try once more with stronger constraint
    if (!output && retryResp.truncated) {
      console.warn('[reasoningStrategy] Retry also truncated, attempting compact retry');
      const compactMsg =
        userMessage +
        TRUNCATION_RETRY_SUFFIX +
        '\n- 每個 string 欄位盡量精簡，避免冗餘描述\n- 如果有超過 8 個 sections，合併相似段落';
      const compactResp = await callJsonOutput(compactMsg);
      output = tryParseAndEnrich(compactResp.content, perIssueAnalysis, legalIssues);
    }

    if (!output) {
      console.error(
        `[reasoningStrategy] All retries failed (first 300 chars): ${resp.content.slice(0, 300)}`,
      );
      throw new Error('論證策略 JSON 解析失敗（重試後仍無法解析）');
    }
  }

  // Validate structure
  const validation = validateStrategyOutput(output, legalIssues);
  if (validation.valid) return output;

  // Retry with validation errors
  console.warn('[reasoningStrategy] Validation failed, retrying:', validation.errors);
  const fixMsg =
    userMessage +
    '\n\n你上次的輸出有以下結構問題，請修正：\n' +
    validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n') +
    '\n\n重要：只輸出純 JSON。';

  const fixResp = await callJsonOutput(fixMsg);

  const fixOutput = tryParse(fixResp.content);
  if (fixOutput) {
    enrichStrategyOutput(fixOutput, perIssueAnalysis, legalIssues);

    // Re-validate the fix attempt
    const fixValidation = validateStrategyOutput(fixOutput, legalIssues);
    if (fixValidation.valid) return fixOutput;

    // Fix attempt still invalid — enrichment may have repaired dispute_ids,
    // so use it if it's better than the original (fewer errors)
    console.warn(
      `[reasoningStrategy] Fix attempt still has ${fixValidation.errors.length} errors (original had ${validation.errors.length})`,
    );
    if (fixValidation.errors.length < validation.errors.length) return fixOutput;
  }

  // Fall back to the original enriched output (enrichment's fuzzy match may have fixed it)
  return output;
};
