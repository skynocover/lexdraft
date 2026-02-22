// ── Orchestrator Agent (Split: Case Reader + Issue Analyzer) ──
// Case Reader: Tool-loop agent using Gemini Flash to read files and produce case summary.
// Issue Analyzer: Single-shot call to identify legal issues from case summary.

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { callAI, callAIStreaming, type AIEnv, type ChatMessage } from './aiClient';
import { collectStreamWithToolCalls } from './sseParser';
import { files } from '../db/schema';
import { getDB } from '../db';
import type { LegalIssue, InformationGap, StructuredFact } from './pipeline/types';
import {
  CASE_READER_SYSTEM_PROMPT,
  CASE_READER_TOOLS,
  ISSUE_ANALYZER_SYSTEM_PROMPT,
  buildCaseReaderInput,
  buildIssueAnalyzerInput,
  formatFileNotes,
  type FileNote,
  type OrchestratorInput,
} from './prompts/orchestratorPrompt';
import { parseJsonField, parseLLMJsonResponse } from './toolHelpers';

// ── Constants ──

const MAX_AGENT_ROUNDS = 8;
const MAX_FILE_READS = 6;
const CASE_READER_TIMEOUT_MS = 90_000;
const ISSUE_ANALYZER_TIMEOUT_MS = 60_000;

// ── Output types ──

export interface CaseReaderOutput {
  caseSummary: string;
  parties: { plaintiff: string; defendant: string };
  timelineSummary: string;
  fileNotes: FileNote[];
}

export interface IssueAnalyzerOutput {
  legalIssues: LegalIssue[];
  informationGaps: InformationGap[];
}

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
  onCaseSummaryStart: () => Promise<void>;
  onCaseSummaryDone: () => Promise<void>;
  onIssueAnalysisStart: () => Promise<void>;
}

// ── Case Reader Agent ──

export const runCaseReader = async (
  aiEnv: AIEnv,
  drizzle: ReturnType<typeof getDB>,
  input: OrchestratorInput,
  signal: AbortSignal,
  progress?: OrchestratorProgressCallback,
): Promise<CaseReaderOutput> => {
  let fileReads = 0;

  // Build conversation
  const messages: ChatMessage[] = [
    { role: 'system', content: CASE_READER_SYSTEM_PROMPT },
    { role: 'user', content: buildCaseReaderInput(input) },
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
  const timeoutId = setTimeout(() => timeoutController.abort(), CASE_READER_TIMEOUT_MS);

  const combinedSignal = AbortSignal.any
    ? AbortSignal.any([signal, timeoutController.signal])
    : signal;

  try {
    // ── Agent Loop ──
    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      if (combinedSignal.aborted) break;

      const response = await callAIStreaming(aiEnv, {
        messages,
        tools: CASE_READER_TOOLS,
        signal: combinedSignal,
      });

      // Parse stream and collect tool calls
      const { content: fullContent, toolCalls } = await collectStreamWithToolCalls(response, round);

      // No tool calls -> agent is done, parse final output
      if (toolCalls.length === 0) {
        if (progress) await progress.onCaseSummaryStart();
        try {
          const result = parseCaseReaderOutput(fullContent, input);
          if (progress) await progress.onCaseSummaryDone();
          return result;
        } catch (parseErr) {
          // JSON parse failed — ask LLM to fix it (one retry)
          if (round < MAX_AGENT_ROUNDS - 1 && !combinedSignal.aborted) {
            console.warn(
              'Case Reader JSON parse failed, retrying with correction prompt:',
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
        return parseCaseReaderOutput(lastAssistant.content, input);
      } catch {
        /* fall through */
      }
    }

    return buildCaseReaderFallback(input);
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Issue Analyzer Agent (single-shot) ──

export const runIssueAnalyzer = async (
  aiEnv: AIEnv,
  caseReaderOutput: CaseReaderOutput,
  briefType: string,
  signal: AbortSignal,
  caseMetadata?: {
    caseNumber: string;
    court: string;
    caseType: string;
    clientRole: string;
    caseInstructions: string;
  },
): Promise<IssueAnalyzerOutput> => {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), ISSUE_ANALYZER_TIMEOUT_MS);

  const combinedSignal = AbortSignal.any
    ? AbortSignal.any([signal, timeoutController.signal])
    : signal;

  try {
    if (combinedSignal.aborted) {
      return { legalIssues: [], informationGaps: [] };
    }

    const userMessage = buildIssueAnalyzerInput({
      caseSummary: caseReaderOutput.caseSummary,
      parties: caseReaderOutput.parties,
      caseMetadata,
      timelineSummary: caseReaderOutput.timelineSummary,
      fileNotes: formatFileNotes(caseReaderOutput.fileNotes),
      briefType,
    });

    const { content } = await callAI(
      aiEnv,
      [
        { role: 'system', content: ISSUE_ANALYZER_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      { maxTokens: 8192, signal: combinedSignal },
    );

    return parseIssueAnalyzerOutput(content);
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

// ── Parse Case Reader output ──

const parseCaseReaderOutput = (content: string, input: OrchestratorInput): CaseReaderOutput => {
  const parsed = parseLLMJsonResponse<{
    case_summary?: string;
    parties?: { plaintiff?: string; defendant?: string };
    timeline_summary?: string;
    file_notes?:
      | Array<{
          filename?: string;
          key_facts?: string[];
          mentioned_laws?: string[];
          claims?: string[];
          key_amounts?: string[];
        }>
      | string;
  }>(content, 'Case Reader Agent 回傳格式不正確');

  const caseSummary = (parsed.case_summary || '').slice(0, 500);
  const timelineSummary = (parsed.timeline_summary || '').slice(0, 800);

  // Parse file_notes: expected array, graceful fallback if string
  let fileNotes: FileNote[];
  if (Array.isArray(parsed.file_notes)) {
    fileNotes = parsed.file_notes.map((n) => ({
      filename: n.filename || '',
      key_facts: n.key_facts || [],
      mentioned_laws: n.mentioned_laws || [],
      claims: n.claims || [],
      key_amounts: n.key_amounts || [],
    }));
  } else if (parsed.file_notes) {
    // Fallback: LLM returned string instead of array
    fileNotes = [
      {
        filename: '(combined)',
        key_facts: [parsed.file_notes.slice(0, 2000)],
        mentioned_laws: [],
        claims: [],
        key_amounts: [],
      },
    ];
  } else {
    fileNotes = [];
  }

  return {
    caseSummary,
    parties: {
      plaintiff: parsed.parties?.plaintiff || input.existingParties.plaintiff || '',
      defendant: parsed.parties?.defendant || input.existingParties.defendant || '',
    },
    timelineSummary,
    fileNotes,
  };
};

// ── Parse Issue Analyzer output ──

const parseIssueAnalyzerOutput = (content: string): IssueAnalyzerOutput => {
  const parsed = parseLLMJsonResponse<{
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
  }>(content, 'Issue Analyzer Agent 回傳格式不正確');

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

  return { legalIssues, informationGaps };
};

// ── Fallback when Case Reader fails ──

const buildCaseReaderFallback = (input: OrchestratorInput): CaseReaderOutput => {
  return {
    caseSummary: input.readyFiles.map((f) => f.filename).join('、'),
    parties: {
      plaintiff: input.existingParties.plaintiff || '',
      defendant: input.existingParties.defendant || '',
    },
    timelineSummary: '',
    fileNotes: [],
  };
};
