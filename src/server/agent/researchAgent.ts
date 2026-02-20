// ── Legal Research Agent ──
// Tool-loop agent using Gemini Flash for law search.
// Batch expand strategy + per-issue stop conditions.

import { callAIStreaming, type AIEnv, type ChatMessage, type ToolCall } from './aiClient';
import { parseOpenAIStream, type OpenAIChunk } from './sseParser';
import { createLawSearchSession } from '../lib/lawSearch';
import type { LawArticle } from '../lib/lawSearch';
import type { ResearchResult, FoundLaw } from './pipeline/types';
import {
  RESEARCH_AGENT_SYSTEM_PROMPT,
  SEARCH_LAW_TOOL,
  buildResearchAgentInput,
  type ResearchAgentInput,
} from './prompts/researchAgentPrompt';
import { parseLLMJsonResponse } from './toolHelpers';

// ── Constants ──

const MAX_ROUNDS_PER_ISSUE = 5;
const MAX_TOTAL_SEARCHES = 20;
const WALL_CLOCK_TIMEOUT_MS = 60_000;
const MAX_AGENT_ROUNDS = 10; // total LLM call rounds

// ── Result types ──

export interface ResearchAgentResult {
  research: ResearchResult[];
  searchedLawIds: Set<string>;
  totalSearches: number;
}

// ── Progress callback ──

export interface ResearchProgressCallback {
  onSearchStart: (query: string) => Promise<void>;
  onSearchResult: (query: string, count: number, laws: string[]) => Promise<void>;
  onIssueComplete: (issueId: string, strength: string) => Promise<void>;
}

// ── Main agent ──

export const runResearchAgent = async (
  aiEnv: AIEnv,
  mongoUrl: string,
  input: ResearchAgentInput,
  signal: AbortSignal,
  progress?: ResearchProgressCallback,
): Promise<ResearchAgentResult> => {
  const searchedLawIds = new Set<string>();
  let totalSearches = 0;

  // Build conversation
  const messages: ChatMessage[] = [
    { role: 'system', content: RESEARCH_AGENT_SYSTEM_PROMPT },
    { role: 'user', content: buildResearchAgentInput(input) },
  ];

  // Shared MongoDB session (one connection for all searches)
  const lawSession = createLawSearchSession(mongoUrl);

  // Tool handler
  const handleSearchLaw = async (query: string, limit: number): Promise<LawArticle[]> => {
    if (totalSearches >= MAX_TOTAL_SEARCHES) {
      return [];
    }
    totalSearches++;

    if (progress) {
      await progress.onSearchStart(query);
    }

    const results = await lawSession.search(query, limit || 5);

    for (const r of results) {
      searchedLawIds.add(r._id);
    }

    if (progress) {
      await progress.onSearchResult(
        query,
        results.length,
        results.map((r) => `${r.law_name} ${r.article_no}`),
      );
    }

    return results;
  };

  // Wall clock timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), WALL_CLOCK_TIMEOUT_MS);

  // Combined signal: user abort OR wall clock timeout
  const combinedSignal = AbortSignal.any
    ? AbortSignal.any([signal, timeoutController.signal])
    : signal; // Fallback for older runtimes

  try {
    // ── Agent Loop ──
    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      if (combinedSignal.aborted) break;
      if (totalSearches >= MAX_TOTAL_SEARCHES) break;

      // Call Gemini with streaming
      const response = await callAIStreaming(aiEnv, {
        messages,
        tools: [SEARCH_LAW_TOOL],
        signal: combinedSignal,
      });

      // Parse stream, accumulate tool calls
      let fullContent = '';
      const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();

      await parseOpenAIStream(response, (chunk: OpenAIChunk) => {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;

        if (delta.content) {
          fullContent += delta.content;
        }

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
              buf.args += tc.function.arguments;
            }
          }
        }
      });

      // Assemble tool calls
      const toolCalls: ToolCall[] = [];
      for (const [, buf] of toolCallBuffers) {
        if (buf.name) {
          toolCalls.push({
            id: buf.id || `call_${round}_${toolCalls.length}`,
            type: 'function',
            function: { name: buf.name, arguments: buf.args || '{}' },
          });
        }
      }

      // No tool calls → agent is done, parse final output
      if (toolCalls.length === 0) {
        try {
          return parseResearchOutput(fullContent, searchedLawIds, totalSearches);
        } catch (parseErr) {
          // JSON parse failed — ask LLM to fix it (one retry)
          if (round < MAX_AGENT_ROUNDS - 1 && !combinedSignal.aborted) {
            console.warn('Research Agent JSON parse failed, retrying:', parseErr);
            messages.push({ role: 'assistant', content: fullContent || '' });
            messages.push({
              role: 'user',
              content:
                '你的輸出不是有效的 JSON。請只輸出 JSON 結果，不要加任何其他文字。確保 JSON 格式完全正確。',
            });
            continue;
          }
          throw parseErr;
        }
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: toolCalls,
      });

      // Execute tool calls
      for (const tc of toolCalls) {
        if (combinedSignal.aborted) break;
        if (totalSearches >= MAX_TOTAL_SEARCHES) {
          messages.push({
            role: 'tool',
            content: JSON.stringify({ error: '已達搜尋上限（20次）' }),
            tool_call_id: tc.id,
          });
          continue;
        }

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          /* empty args */
        }

        if (tc.function.name === 'search_law') {
          const query = (args.query as string) || '';
          const limit = (args.limit as number) || 5;

          const results = await handleSearchLaw(query, limit);

          // Format results for LLM
          const resultText =
            results.length > 0
              ? results
                  .map(
                    (r) => `[${r._id}] ${r.law_name} ${r.article_no}\n${r.content.slice(0, 300)}`,
                  )
                  .join('\n\n')
              : '沒有找到相關法條。請嘗試換個關鍵字（如用全名取代縮寫、或用更廣的概念搜尋）。';

          messages.push({
            role: 'tool',
            content: resultText,
            tool_call_id: tc.id,
          });
        } else {
          messages.push({
            role: 'tool',
            content: `Unknown tool: ${tc.function.name}`,
            tool_call_id: tc.id,
          });
        }
      }
    }

    // Max rounds reached without final output — force extraction
    // Try to parse whatever content we have
    const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
    if (lastAssistant?.content) {
      try {
        return parseResearchOutput(lastAssistant.content, searchedLawIds, totalSearches);
      } catch {
        /* fall through */
      }
    }

    // Build fallback result from collected data
    return buildFallbackResult(searchedLawIds, totalSearches, input.legalIssues);
  } finally {
    clearTimeout(timeoutId);
    await lawSession.close();
  }
};

// ── Parse final research output from LLM ──

const parseResearchOutput = (
  content: string,
  searchedLawIds: Set<string>,
  totalSearches: number,
): ResearchAgentResult => {
  const parsed = parseLLMJsonResponse<{ research: ResearchResult[] }>(
    content,
    '研究 Agent 回傳格式不正確',
  );
  if (!parsed.research || !Array.isArray(parsed.research)) {
    throw new Error('研究 Agent 輸出格式不正確（缺少 research 陣列）');
  }

  // Validate defense_risk laws were actually searched
  for (const r of parsed.research) {
    for (const law of r.found_laws) {
      if (law.side === 'defense_risk' && !searchedLawIds.has(law.id)) {
        // Mark as reference instead — LLM claimed defense_risk but didn't actually search
        law.side = 'reference';
      }
    }
  }

  return { research: parsed.research, searchedLawIds, totalSearches };
};

// ── Build fallback when agent doesn't produce structured output ──

const buildFallbackResult = (
  searchedLawIds: Set<string>,
  totalSearches: number,
  legalIssues: ResearchAgentInput['legalIssues'],
): ResearchAgentResult => {
  // Create empty research results for each issue
  const research: ResearchResult[] = legalIssues.map((issue) => ({
    issue_id: issue.id,
    strength: 'moderate' as const,
    found_laws: [],
    analysis: '法律研究 Agent 未能產出結構化結果，請參考已搜尋到的法條。',
    attack_points: [],
    defense_risks: [],
  }));

  return { research, searchedLawIds, totalSearches };
};
