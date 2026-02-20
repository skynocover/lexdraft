import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from 'react';
import { useParams } from 'react-router';
import { ChevronsLeft } from 'lucide-react';
import { useChatStore } from '../../stores/useChatStore';
import { useUIStore } from '../../stores/useUIStore';
import { MessageBubble } from '../chat/MessageBubble';

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

  // Find last assistant message id
  const lastAssistantId = useMemo(
    () => messages.findLast((m) => m.role === 'assistant')?.id ?? null,
    [messages],
  );

  // Detect if a write_full_brief pipeline is actively running (has its own progress UI)
  const hasPipelineRunning = useMemo(
    () =>
      messages.some(
        (m) =>
          m.role === 'tool_call' &&
          m.metadata?.tool_name === 'write_full_brief' &&
          m.metadata?.status === 'running' &&
          Array.isArray(m.metadata?.pipeline_steps),
      ),
    [messages],
  );

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Prefill input from floating toolbar
  useEffect(() => {
    if (prefillInput) {
      setInput(prefillInput);
      setPrefillInput(null);
      // Wait for React to re-render with new value before measuring height
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
      });
    }
  }, [prefillInput]);

  const handleSend = () => {
    if (!input.trim() || !caseId || isStreaming) return;
    sendMessage(caseId, input.trim());
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 輸入中（如注音/拼音選字）不攔截 Enter
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
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
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  };

  return (
    <aside className="flex min-h-0 w-80 shrink-0 flex-1 flex-col border-r border-bd bg-bg-1">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-bd px-3 py-2">
        <span className="text-[13px] font-medium text-t2">AI 助理</span>
        <div className="flex items-center gap-1">
          {messages.length > 0 && !isStreaming && (
            <button onClick={handleClear} className="text-xs text-t3 hover:text-rd">
              清除對話
            </button>
          )}
          <button
            onClick={() => useUIStore.getState().toggleLeftSidebar()}
            className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
            title="收合 AI 助理"
          >
            <ChevronsLeft size={14} />
          </button>
        </div>
      </div>

      {/* Message list */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-center text-xs text-t3">在下方輸入指令開始對話</p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const nextToolResult =
            msg.role === 'tool_call'
              ? messages.slice(idx + 1).find((m) => m.role === 'tool_result')
              : undefined;
          const isLastAssistant = msg.id === lastAssistantId;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={isStreaming}
              nextToolResult={nextToolResult}
              isLastAssistant={isLastAssistant}
              caseId={caseId}
            />
          );
        })}

        {/* Progress indicator (hidden when pipeline has its own progress) */}
        {agentProgress && isStreaming && !hasPipelineRunning && (
          <div className="flex items-center gap-2 px-2 py-1">
            <div className="h-1 flex-1 rounded-full bg-bg-3">
              <div
                className="h-1 rounded-full bg-ac transition-all"
                style={{
                  width: `${(agentProgress.current / agentProgress.total) * 100}%`,
                }}
              />
            </div>
            <span className="text-[11px] text-t3">
              {agentProgress.current}/{agentProgress.total}
            </span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded border border-rd/30 bg-rd/10 px-3 py-2 text-xs text-rd">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-t3 hover:text-t1">
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
