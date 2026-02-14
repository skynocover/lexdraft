import { useState, useRef, useEffect, memo, type KeyboardEvent } from "react";
import { useParams } from "react-router";
import Markdown from "react-markdown";
import { useChatStore, type ChatMessage } from "../../stores/useChatStore";
import { useUIStore } from "../../stores/useUIStore";

export function ChatPanel() {
  const { caseId } = useParams();
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const agentProgress = useChatStore((s) => s.agentProgress);
  const error = useChatStore((s) => s.error);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancelChat = useChatStore((s) => s.cancelChat);
  const setError = useChatStore((s) => s.setError);
  const clearConversation = useChatStore((s) => s.clearConversation);

  const prefillInput = useChatStore((s) => s.prefillInput);
  const setPrefillInput = useChatStore((s) => s.setPrefillInput);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Prefill input from floating toolbar
  useEffect(() => {
    if (prefillInput) {
      setInput(prefillInput);
      setPrefillInput(null);
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 120) + "px";
      }
    }
  }, [prefillInput]);

  const handleSend = () => {
    if (!input.trim() || !caseId || isStreaming) return;
    sendMessage(caseId, input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 輸入中（如注音/拼音選字）不攔截 Enter
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCancel = () => {
    if (caseId) cancelChat(caseId);
  };

  const handleClear = () => {
    if (caseId && !isStreaming) clearConversation(caseId);
  };

  // Auto-resize textarea
  const handleInputChange = (value: string) => {
    setInput(value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-bd bg-bg-1">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-bd px-3 py-2">
        <span className="text-xs font-medium text-t2">AI 助理</span>
        <div className="flex items-center gap-1">
          {messages.length > 0 && !isStreaming && (
            <button
              onClick={handleClear}
              className="text-[11px] text-t3 hover:text-rd"
            >
              清除對話
            </button>
          )}
          <button
            onClick={() => useUIStore.getState().toggleLeftSidebar()}
            className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
            title="收合 AI 助理"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Message list */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-center text-xs text-t3">
              在下方輸入指令開始對話
            </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const nextToolResult =
            msg.role === "tool_call"
              ? messages.slice(idx + 1).find((m) => m.role === "tool_result")
              : undefined;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={isStreaming}
              nextToolResult={nextToolResult}
            />
          );
        })}

        {/* Progress indicator */}
        {agentProgress && isStreaming && (
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="h-1 flex-1 rounded-full bg-bg-3">
              <div
                className="h-1 rounded-full bg-ac transition-all"
                style={{
                  width: `${(agentProgress.current / agentProgress.total) * 100}%`,
                }}
              />
            </div>
            <span className="text-[10px] text-t3">
              {agentProgress.current}/{agentProgress.total}
            </span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded border border-rd/30 bg-rd/10 px-3 py-2 text-xs text-rd">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-t3 hover:text-t1"
            >
              x
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-bd p-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入指令..."
            rows={1}
            className="flex-1 resize-none rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              onClick={handleCancel}
              className="shrink-0 rounded bg-rd px-3 py-2 text-sm font-medium text-bg-0 hover:bg-rd/80"
            >
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="shrink-0 rounded bg-ac px-3 py-2 text-sm font-medium text-bg-0 hover:bg-ac/80 disabled:opacity-50"
            >
              送出
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

// --- Message Bubble ---

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  nextToolResult,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  nextToolResult?: ChatMessage;
}) {
  const [expanded, setExpanded] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-ac/15 px-3 py-2 text-sm text-t1">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.role === "assistant") {
    // Hide empty assistant bubbles (happens when AI only calls tools)
    if (!message.content && !isStreaming) return null;

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
        </div>
      </div>
    );
  }

  if (message.role === "tool_call") {
    const meta = message.metadata || {};
    const status = meta.status as string | undefined;
    const toolName = (meta.tool_name as string) || message.content;
    const toolArgs = (meta.tool_args || meta.args) as
      | Record<string, unknown>
      | undefined;

    const fullResult = nextToolResult?.content;
    const resultMeta = nextToolResult?.metadata || {};
    const success = (meta.success ?? resultMeta.success) as boolean | undefined;

    // Determine if completed: has tool_result or SSE marked done
    const isDone = status === "done" || !!nextToolResult;
    const isRunning = status === "running" && !nextToolResult;

    // Build label
    const label = getToolLabel(
      toolName,
      toolArgs,
      fullResult,
      isRunning ? "running" : "done",
    );

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
          <span className="shrink-0 text-t3">{expanded ? "▲" : "▼"}</span>
        </button>

        {expanded && (
          <div className="border-t border-bd px-3 py-2 space-y-2">
            {/* Structured display for list_files */}
            {toolName === "list_files" && !!fullResult && (
              <FileListDisplay content={fullResult} />
            )}

            {/* Structured display for read_file */}
            {toolName === "read_file" && !!fullResult && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-t2">
                {fullResult.length > 500
                  ? fullResult.slice(0, 500) + "..."
                  : fullResult}
              </pre>
            )}

            {/* Structured display for create_brief */}
            {toolName === "create_brief" && !!fullResult && (
              <p className="text-t2">{fullResult}</p>
            )}

            {/* Structured display for write_brief_section */}
            {toolName === "write_brief_section" && !!fullResult && (
              <p className="text-t2">{fullResult}</p>
            )}

            {/* Structured display for analyze_disputes */}
            {toolName === "analyze_disputes" && !!fullResult && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-t2">
                {fullResult}
              </pre>
            )}

            {/* Structured display for search_law */}
            {toolName === "search_law" && !!fullResult && (
              <SearchLawDisplay
                content={fullResult}
                query={toolArgs?.query as string | undefined}
              />
            )}

            {/* Fallback for unknown tools */}
            {![
              "list_files",
              "read_file",
              "create_brief",
              "write_brief_section",
              "analyze_disputes",
              "search_law",
            ].includes(toolName) &&
              !!fullResult && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-t2">
                  {fullResult.length > 500
                    ? fullResult.slice(0, 500) + "..."
                    : fullResult}
                </pre>
              )}

            {/* Show "running" placeholder if no result yet */}
            {!fullResult && isRunning && (
              <span className="text-t3">執行中...</span>
            )}
          </div>
        )}
      </div>
    );
  }

  // tool_result — skip rendering (merged into tool_call card)
  return null;
});

// --- Tool display helpers ---

function getToolLabel(
  toolName: string,
  args: Record<string, unknown> | undefined,
  fullResult: string | undefined,
  status: string,
): string {
  if (toolName === "list_files") {
    if (status === "running") return "正在讀取檔案清單...";
    if (fullResult) {
      try {
        const files = JSON.parse(fullResult);
        if (Array.isArray(files)) return `list_files — ${files.length} 個檔案`;
      } catch {
        /* ignore */
      }
    }
    return "list_files";
  }

  if (toolName === "read_file") {
    if (status === "running") return "正在讀取檔案...";
    if (fullResult) {
      const match = fullResult.match(/檔案：(.+?)\n/);
      if (match) return `read_file — ${match[1]}`;
    }
    if (args?.file_id)
      return `read_file — ${String(args.file_id).slice(0, 12)}...`;
    return "read_file";
  }

  if (toolName === "create_brief") {
    const title = args?.title as string | undefined;
    if (status === "running") return `正在建立書狀...`;
    return `已建立書狀「${title || "書狀"}」`;
  }

  if (toolName === "write_brief_section") {
    const section = args?.section as string | undefined;
    const subsection = args?.subsection as string | undefined;
    const label = subsection || section || "段落";
    if (status === "running") return `正在撰寫 ${label}...`;
    return `已撰寫 ${label}`;
  }

  if (toolName === "analyze_disputes") {
    if (status === "running") return "正在分析爭點...";
    if (fullResult) {
      const match = fullResult.match(/已識別 (\d+) 個爭點/);
      if (match) return `已識別 ${match[1]} 個爭點`;
    }
    return "已分析爭點";
  }

  if (toolName === "search_law") {
    const query = args?.query as string | undefined;
    if (status === "running") return `正在搜尋「${query || "..."}」...`;
    if (fullResult) {
      const match = fullResult.match(/找到 (\d+) 條/);
      if (match) return `search_law「${query || ""}」— ${match[1]} 條結果`;
    }
    return `search_law「${query || ""}」`;
  }

  if (toolName === "calculate_damages") {
    if (status === "running") return "正在計算金額...";
    return "已計算金額";
  }

  if (toolName === "generate_timeline") {
    if (status === "running") return "正在分析時間軸...";
    return "已產生時間軸";
  }

  return toolName;
}

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

  const categoryLabel: Record<string, string> = {
    ours: "我方",
    theirs: "對方",
    court: "法院",
    evidence: "證據",
    other: "其他",
  };

  return (
    <div className="space-y-1">
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${getCategoryColor(f.category)}`}
          >
            {categoryLabel[f.category || "other"] || "其他"}
          </span>
          <span className="min-w-0 truncate text-t1">{f.filename}</span>
          {f.status === "ready" && (
            <span className="shrink-0 text-gr">&#10003;</span>
          )}
          {f.status === "processing" && (
            <span className="shrink-0 text-yl">&#8987;</span>
          )}
        </div>
      ))}
    </div>
  );
}

function getCategoryColor(category: string | null): string {
  switch (category) {
    case "ours":
      return "bg-ac/20 text-ac";
    case "theirs":
      return "bg-or/20 text-or";
    case "court":
      return "bg-pu/20 text-pu";
    case "evidence":
      return "bg-cy/20 text-cy";
    default:
      return "bg-bg-4 text-t3";
  }
}

function SearchLawDisplay({
  content,
  query,
}: {
  content: string;
  query?: string;
}) {
  // Parse search_law result lines: [ID] 法規名 條號：內容...
  const LINE_REGEX = /^\[([^\]]+)\]\s*(.+?)：(.+)$/;
  const lines = content.split("\n").filter((l) => LINE_REGEX.test(l));

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
        <p className="text-[10px] text-t3">
          搜尋：<span className="text-t2">{query}</span>
        </p>
      )}
      {lines.map((line, i) => {
        const match = line.match(LINE_REGEX);
        if (!match) return null;
        const [, , title, preview] = match;
        return (
          <div key={i} className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 rounded bg-purple-500/20 px-1 py-0.5 text-[9px] font-medium text-purple-400">
              法規
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-t1">{title}</p>
              <p className="truncate text-[10px] text-t3">{preview}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
