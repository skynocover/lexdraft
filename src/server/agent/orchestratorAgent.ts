// ── Orchestrator Agent ──
// Tool-loop agent using Gemini Flash for case analysis.
// Reads case files and produces comprehensive analysis to seed ContextStore.

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { callAIStreaming, type AIEnv, type ChatMessage, type ToolCall } from './aiClient';
import { collectStreamWithToolCalls } from './sseParser';
import { files } from '../db/schema';
import { getDB } from '../db';
import type { LegalIssue, InformationGap, StructuredFact } from './pipeline/types';
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  ORCHESTRATOR_TOOLS,
  buildOrchestratorInput,
  type OrchestratorInput,
} from './prompts/orchestratorPrompt';
import { parseJsonField, parseLLMJsonResponse } from './toolHelpers';

// ── Constants ──

const MAX_AGENT_ROUNDS = 8;
const MAX_FILE_READS = 6;
const WALL_CLOCK_TIMEOUT_MS = 90_000;

// ── Output type ──

export interface OrchestratorOutput {
  caseSummary: string;
  parties: { plaintiff: string; defendant: string };
  timelineSummary: string;
  legalIssues: LegalIssue[];
  informationGaps: InformationGap[];
}

// ── Progress callback ──

export interface OrchestratorProgressCallback {
  onFileReadStart: (filename: string) => Promise<void>;
  onFileReadDone: (filename: string) => Promise<void>;
  onAnalysisStart: () => Promise<void>;
}

// ── Main agent ──

export const runOrchestratorAgent = async (
  aiEnv: AIEnv,
  drizzle: ReturnType<typeof getDB>,
  input: OrchestratorInput,
  signal: AbortSignal,
  progress?: OrchestratorProgressCallback,
): Promise<OrchestratorOutput> => {
  let fileReads = 0;

  // Build conversation
  const messages: ChatMessage[] = [
    { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
    { role: 'user', content: buildOrchestratorInput(input) },
  ];

  // Tool handlers
  const readFileIds = new Set<string>();
  const handleReadFile = async (fileId: string): Promise<string> => {
    if (fileReads >= MAX_FILE_READS) {
      return '已達閱讀上限（6 份），請用摘要完成分析。';
    }

    // Skip duplicate reads (LLM may request the same file twice)
    if (readFileIds.has(fileId)) {
      return `檔案已讀取過（${fileId}），請用已有資訊繼續分析。`;
    }
    readFileIds.add(fileId);
    fileReads++;

    const rows = await drizzle
      .select({
        id: files.id,
        filename: files.filename,
        full_text: files.full_text,
      })
      .from(files)
      .where(eq(files.id, fileId));

    if (!rows.length) return `檔案不存在（id: ${fileId}）`;

    const row = rows[0];

    const text = row.full_text || '（無文字內容）';
    const truncated = text.length > 15000 ? text.slice(0, 15000) + '...' : text;
    return `檔案：${row.filename}\n\n${truncated}`;
  };

  const handleListFiles = (): string => {
    return input.readyFiles
      .map((f) => {
        const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
        const summaryText = (summary.summary as string) || '（無摘要）';
        return `[${f.id}] ${f.filename}（${f.category || '未分類'}）\n  摘要：${summaryText}`;
      })
      .join('\n\n');
  };

  // Wall clock timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), WALL_CLOCK_TIMEOUT_MS);

  const combinedSignal = AbortSignal.any
    ? AbortSignal.any([signal, timeoutController.signal])
    : signal;

  try {
    // ── Agent Loop ──
    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      if (combinedSignal.aborted) break;

      const response = await callAIStreaming(aiEnv, {
        messages,
        tools: ORCHESTRATOR_TOOLS,
        signal: combinedSignal,
      });

      // Parse stream and collect tool calls
      const { content: fullContent, toolCalls } = await collectStreamWithToolCalls(response, round);

      // No tool calls → agent is done, parse final output
      if (toolCalls.length === 0) {
        if (progress) await progress.onAnalysisStart();
        try {
          return parseOrchestratorOutput(fullContent, input);
        } catch (parseErr) {
          // JSON parse failed — ask LLM to fix it (one retry)
          if (round < MAX_AGENT_ROUNDS - 1 && !combinedSignal.aborted) {
            console.warn(
              'Orchestrator JSON parse failed, retrying with correction prompt:',
              parseErr,
            );
            messages.push({ role: 'assistant', content: fullContent || '' });
            messages.push({
              role: 'user',
              content:
                '你的輸出不是有效的 JSON。請只輸出 JSON 結果，不要加任何其他文字、markdown 或解釋。確保 JSON 格式完全正確（沒有 trailing comma、所有字串用雙引號）。',
            });
            continue; // Retry the agent loop
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

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          /* empty args */
        }

        if (tc.function.name === 'read_file') {
          const fileId = (args.file_id as string) || '';
          const fileInfo = input.readyFiles.find((f) => f.id === fileId);
          const filename = fileInfo?.filename || fileId;
          const isDuplicate = readFileIds.has(fileId);
          if (progress && !isDuplicate) {
            await progress.onFileReadStart(filename);
          }
          const result = await handleReadFile(fileId);
          if (progress && !isDuplicate) {
            await progress.onFileReadDone(filename);
          }
          messages.push({ role: 'tool', content: result, tool_call_id: tc.id });
        } else if (tc.function.name === 'list_files') {
          const result = handleListFiles();
          messages.push({ role: 'tool', content: result, tool_call_id: tc.id });
        } else {
          messages.push({
            role: 'tool',
            content: `Unknown tool: ${tc.function.name}`,
            tool_call_id: tc.id,
          });
        }
      }
    }

    // Max rounds reached — try to parse last content
    const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
    if (lastAssistant?.content) {
      try {
        return parseOrchestratorOutput(lastAssistant.content, input);
      } catch {
        /* fall through */
      }
    }

    return buildFallbackOutput(input);
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Normalize helpers ──

const VALID_ASSERTION_TYPES = ['主張', '承認', '爭執', '自認', '推定'] as const;
const normalizeAssertionType = (raw?: string): StructuredFact['assertion_type'] => {
  if (raw && (VALID_ASSERTION_TYPES as readonly string[]).includes(raw))
    return raw as StructuredFact['assertion_type'];
  return '主張';
};

const VALID_SOURCE_SIDES = ['我方', '對方', '中立'] as const;
const normalizeSourceSide = (raw?: string): StructuredFact['source_side'] => {
  if (raw && (VALID_SOURCE_SIDES as readonly string[]).includes(raw))
    return raw as StructuredFact['source_side'];
  return '中立';
};

// ── Parse final output from LLM ──

const parseOrchestratorOutput = (content: string, input: OrchestratorInput): OrchestratorOutput => {
  const parsed = parseLLMJsonResponse<{
    case_summary?: string;
    parties?: { plaintiff?: string; defendant?: string };
    timeline_summary?: string;
    legal_issues?: Array<{
      title?: string;
      our_position?: string;
      their_position?: string;
      key_evidence?: string[];
      mentioned_laws?: string[];
      facts?: Array<{
        description?: string;
        assertion_type?: string;
        source_side?: string;
        evidence?: string[];
        disputed_by_description?: string;
      }>;
    }>;
    information_gaps?: Array<{
      severity?: string;
      description?: string;
      related_issue_index?: number;
      suggestion?: string;
    }>;
  }>(content, 'Orchestrator Agent 回傳格式不正確');

  // Generate IDs for legal issues
  const legalIssues: LegalIssue[] = (parsed.legal_issues || []).map((issue) => ({
    id: nanoid(),
    title: issue.title || '未命名爭點',
    our_position: issue.our_position || '',
    their_position: issue.their_position || '',
    key_evidence: issue.key_evidence || [],
    mentioned_laws: issue.mentioned_laws || [],
    facts: (issue.facts || []).map((f) => ({
      id: nanoid(),
      description: f.description || '',
      assertion_type: normalizeAssertionType(f.assertion_type),
      source_side: normalizeSourceSide(f.source_side),
      evidence: f.evidence || [],
      disputed_by: f.disputed_by_description || null,
    })),
  }));

  // Link information gaps to issues by index
  const informationGaps: InformationGap[] = (parsed.information_gaps || []).map((gap) => {
    const relatedIndex = gap.related_issue_index ?? 0;
    const relatedIssue = legalIssues[relatedIndex];
    return {
      id: nanoid(),
      severity: (gap.severity === 'critical' ? 'critical' : 'nice_to_have') as
        | 'critical'
        | 'nice_to_have',
      description: gap.description || '',
      related_issue_id: relatedIssue?.id || '',
      suggestion: gap.suggestion || '',
    };
  });

  const caseSummary = (parsed.case_summary || '').slice(0, 500);
  const timelineSummary = (parsed.timeline_summary || '').slice(0, 800);

  return {
    caseSummary,
    parties: {
      plaintiff: parsed.parties?.plaintiff || input.existingParties.plaintiff || '',
      defendant: parsed.parties?.defendant || input.existingParties.defendant || '',
    },
    timelineSummary,
    legalIssues,
    informationGaps,
  };
};

// ── Fallback when agent fails ──

const buildFallbackOutput = (input: OrchestratorInput): OrchestratorOutput => {
  return {
    caseSummary: input.readyFiles.map((f) => f.filename).join('、'),
    parties: {
      plaintiff: input.existingParties.plaintiff || '',
      defendant: input.existingParties.defendant || '',
    },
    timelineSummary: '',
    legalIssues: [],
    informationGaps: [],
  };
};
