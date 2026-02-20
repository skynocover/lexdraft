import { useState, memo } from 'react';
import Markdown from 'react-markdown';
import { useChatStore, type ChatMessage } from '../../stores/useChatStore';
import { useRewindStore } from '../../stores/useRewindStore';
import { QuickActionButtons } from './QuickActionButtons';
import { PipelineStages } from './PipelineStages';
import { getCategoryTagCls, getCategoryLabel } from '../../lib/categoryConfig';
import { getToolLabel } from './getToolLabel';
import type { PipelineStep } from '../../../shared/types';

export const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  nextToolResult,
  isLastAssistant,
  caseId,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  nextToolResult?: ChatMessage;
  isLastAssistant?: boolean;
  caseId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const snapshot = useRewindStore((s) =>
    message.role === 'assistant' ? s.snapshots[message.id] : undefined,
  );

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-ac/15 px-3 py-2 text-sm text-t1">
          <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.role === 'assistant') {
    // Hide empty assistant bubbles (happens when AI only calls tools)
    if (!message.content && !isStreaming) return null;

    const handleQuickAction = (prompt: string) => {
      if (caseId) useChatStore.getState().sendMessage(caseId, prompt);
    };

    const handleRewind = () => {
      useRewindStore.getState().rewind(message.id);
    };

    const suggestedActions = (message.metadata?.suggested_actions ?? []) as {
      label: string;
      prompt: string;
    }[];
    const showRewind = !!snapshot?.hadChanges && !isStreaming;
    const showSuggestions = isLastAssistant && !isStreaming;

    return (
      <div className="flex justify-start">
        <div className="chat-markdown max-w-[85%] rounded-lg bg-bg-3 px-3 py-2 text-sm text-t1">
          {message.content ? (
            <>
              <Markdown>{message.content}</Markdown>
              {isStreaming && <span className="animate-pulse">|</span>}
            </>
          ) : (
            <span className="text-t3">...</span>
          )}
          {(showRewind || (showSuggestions && suggestedActions.length > 0)) && (
            <QuickActionButtons
              actions={showSuggestions ? suggestedActions : []}
              onAction={handleQuickAction}
              showRewind={showRewind}
              onRewind={handleRewind}
            />
          )}
        </div>
      </div>
    );
  }

  if (message.role === 'tool_call') {
    const meta = message.metadata || {};
    const status = meta.status as string | undefined;
    const toolName = (meta.tool_name as string) || message.content;
    const toolArgs = (meta.tool_args || meta.args) as Record<string, unknown> | undefined;
    const pipelineSteps = meta.pipeline_steps as PipelineStep[] | undefined;

    const fullResult = nextToolResult?.content;
    const resultMeta = nextToolResult?.metadata || {};
    const success = (meta.success ?? resultMeta.success) as boolean | undefined;

    // Determine if completed: has tool_result or SSE marked done
    const isDone = status === 'done' || !!nextToolResult;
    const isRunning = status === 'running' && !nextToolResult;

    // Special rendering for write_full_brief pipeline
    if (toolName === 'write_full_brief' && pipelineSteps && pipelineSteps.length > 0) {
      return <PipelineStages steps={pipelineSteps} />;
    }

    // Build label
    const label = getToolLabel(toolName, toolArgs, fullResult, isRunning ? 'running' : 'done');

    return (
      <div className="rounded border border-bd bg-bg-2 text-xs">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-3"
        >
          <span className="shrink-0">
            {isRunning ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ac border-t-transparent" />
            ) : isDone && success !== false ? (
              <span className="text-gr">&#10003;</span>
            ) : success === false ? (
              <span className="text-rd">&#10007;</span>
            ) : (
              <span className="text-t3">&#10003;</span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-t2">{label}</span>
          <span className="shrink-0 text-t3">{expanded ? '▲' : '▼'}</span>
        </button>

        {expanded && (
          <div className="border-t border-bd px-3 py-2 space-y-2">
            {/* Structured display for list_files */}
            {toolName === 'list_files' && !!fullResult && <FileListDisplay content={fullResult} />}

            {/* Structured display for read_file */}
            {toolName === 'read_file' && !!fullResult && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-t2">
                {fullResult.length > 500 ? fullResult.slice(0, 500) + '...' : fullResult}
              </pre>
            )}

            {/* Structured display for create_brief */}
            {toolName === 'create_brief' && !!fullResult && <p className="text-t2">{fullResult}</p>}

            {/* Structured display for write_brief_section */}
            {toolName === 'write_brief_section' && !!fullResult && (
              <p className="text-t2">{fullResult}</p>
            )}

            {/* Structured display for analyze_disputes */}
            {toolName === 'analyze_disputes' && !!fullResult && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-t2">{fullResult}</pre>
            )}

            {/* Structured display for search_law */}
            {toolName === 'search_law' && !!fullResult && (
              <SearchLawDisplay
                content={fullResult}
                query={toolArgs?.query as string | undefined}
              />
            )}

            {/* Fallback for unknown tools */}
            {![
              'list_files',
              'read_file',
              'create_brief',
              'write_brief_section',
              'analyze_disputes',
              'search_law',
            ].includes(toolName) &&
              !!fullResult && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-t2">
                  {fullResult.length > 500 ? fullResult.slice(0, 500) + '...' : fullResult}
                </pre>
              )}

            {/* Show "running" placeholder if no result yet */}
            {!fullResult && isRunning && <span className="text-t3">執行中...</span>}
          </div>
        )}
      </div>
    );
  }

  // tool_result — skip rendering (merged into tool_call card)
  return null;
});

// --- Tool result display helpers ---

function FileListDisplay({ content }: { content: string }) {
  // Parse the full tool result JSON
  let files: Array<{
    filename: string;
    category: string | null;
    status: string | null;
  }> = [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) files = parsed;
  } catch {
    return (
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-t2">
        {content.slice(0, 500)}
      </pre>
    );
  }

  if (!files.length) {
    return <span className="text-t3">（無檔案）</span>;
  }

  return (
    <div className="space-y-1">
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className={`shrink-0 rounded px-1 py-0.5 text-[11px] font-medium ${getCategoryTagCls(f.category)}`}
          >
            {getCategoryLabel(f.category)}
          </span>
          <span className="min-w-0 truncate text-t1">{f.filename}</span>
          {f.status === 'ready' && <span className="shrink-0 text-gr">&#10003;</span>}
          {f.status === 'processing' && <span className="shrink-0 text-yl">&#8987;</span>}
        </div>
      ))}
    </div>
  );
}

function SearchLawDisplay({ content, query }: { content: string; query?: string }) {
  // Parse search_law result lines: [ID] 法規名 條號：內容...
  const LINE_REGEX = /^\[([^\]]+)\]\s*(.+?)：(.+)$/;
  const lines = content.split('\n').filter((l) => LINE_REGEX.test(l));

  if (!lines.length) {
    return (
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-t2">
        {content.slice(0, 500)}
      </pre>
    );
  }

  return (
    <div className="space-y-1.5">
      {query && (
        <p className="text-[11px] text-t3">
          搜尋：<span className="text-t2">{query}</span>
        </p>
      )}
      {lines.map((line, i) => {
        const match = line.match(LINE_REGEX);
        if (!match) return null;
        const [, , title, preview] = match;
        return (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 rounded bg-purple-500/20 px-1 py-0.5 text-[11px] font-medium text-purple-400">
              法規
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-t1">{title}</p>
              <p className="truncate text-[11px] text-t3">{preview}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
