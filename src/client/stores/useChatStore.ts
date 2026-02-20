import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { useAuthStore } from './useAuthStore';
import { useBriefStore, type Brief, type Paragraph, type LawRef } from './useBriefStore';
import {
  useAnalysisStore,
  type Dispute,
  type Damage,
  type TimelineEvent,
  type Party,
  type ClaimGraph,
} from './useAnalysisStore';
import { useTabStore } from './useTabStore';
import { useRewindStore } from './useRewindStore';
import type { SSEEvent, ChatMessageRecord, ChatRequest } from '../../shared/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_ntd: number;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  agentProgress: { current: number; total: number } | null;
  tokenUsage: TokenUsage | null;
  error: string | null;
  prefillInput: string | null;

  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (id: string, text: string) => void;
  clearMessages: () => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setAgentProgress: (progress: { current: number; total: number } | null) => void;
  setTokenUsage: (usage: TokenUsage | null) => void;
  setError: (error: string | null) => void;
  setPrefillInput: (text: string | null) => void;

  loadHistory: (caseId: string) => Promise<void>;
  sendMessage: (caseId: string, message: string) => Promise<void>;
  cancelChat: (caseId: string) => Promise<void>;
  clearConversation: (caseId: string) => Promise<void>;

  _abortController: AbortController | null;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  agentProgress: null,
  tokenUsage: null,
  error: null,
  prefillInput: null,
  _abortController: null,

  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  updateMessage: (id, updates) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  appendToMessage: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + text } : m)),
    })),
  clearMessages: () => set({ messages: [], tokenUsage: null, error: null, agentProgress: null }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setAgentProgress: (agentProgress) => set({ agentProgress }),
  setTokenUsage: (tokenUsage) => set({ tokenUsage }),
  setError: (error) => set({ error }),
  setPrefillInput: (prefillInput) => set({ prefillInput }),

  loadHistory: async (caseId: string) => {
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`/api/cases/${caseId}/messages`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load messages');
      const data = (await res.json()) as ChatMessageRecord[];
      set({
        messages: data.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          metadata: m.metadata ?? undefined,
          created_at: m.created_at,
        })),
      });
    } catch (err) {
      console.error('loadHistory error:', err);
    }
  },

  sendMessage: async (caseId: string, message: string) => {
    const {
      addMessage,
      appendToMessage,
      updateMessage,
      setIsStreaming,
      setAgentProgress,
      setTokenUsage,
      setError,
    } = get();

    // Optimistic add user message
    const userMsgId = nanoid();
    addMessage({
      id: userMsgId,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    });

    setIsStreaming(true);
    setError(null);
    setAgentProgress(null);

    const abortController = new AbortController();
    set({ _abortController: abortController });

    try {
      const token = useAuthStore.getState().token;

      // Build brief context from current brief
      const briefState = useBriefStore.getState();
      const currentBrief = briefState.currentBrief;
      const requestBody: ChatRequest = { message };
      if (currentBrief) {
        const paragraphs = currentBrief.content_structured?.paragraphs ?? [];
        requestBody.briefContext = {
          brief_id: currentBrief.id,
          title: currentBrief.title || currentBrief.brief_type,
          paragraphs: paragraphs.map((p) => ({
            id: p.id,
            section: p.section,
            subsection: p.subsection,
            content_preview: p.content_md?.slice(0, 80) || '',
          })),
        };
      }

      const res = await fetch(`/api/cases/${caseId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error: string }).error || res.statusText);
      }

      // Parse SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentAssistantId: string | null = null;
      let rewindTargetId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data) as SSEEvent;

            switch (event.type) {
              case 'message_start': {
                currentAssistantId = event.message_id;
                const rStore = useRewindStore.getState();
                const prevSnap = rewindTargetId ? rStore.snapshots[rewindTargetId] : null;
                if (prevSnap?.hadChanges && rewindTargetId) {
                  // Transfer pre-change snapshot from hidden msg to new visible msg
                  rStore.transferSnapshot(rewindTargetId, event.message_id);
                } else {
                  // Remove stale empty snapshot and capture fresh one
                  if (rewindTargetId) {
                    rStore.removeSnapshot(rewindTargetId);
                  }
                  rStore.captureSnapshot(event.message_id);
                }
                rewindTargetId = event.message_id;
                addMessage({
                  id: event.message_id,
                  role: 'assistant',
                  content: '',
                  created_at: new Date().toISOString(),
                });
                break;
              }

              case 'text_delta':
                if (currentAssistantId) {
                  appendToMessage(currentAssistantId, event.delta);
                }
                break;

              case 'message_end':
                currentAssistantId = null;
                break;

              case 'tool_call_start':
                addMessage({
                  id: event.message_id,
                  role: 'tool_call',
                  content: event.tool_name,
                  metadata: {
                    tool_name: event.tool_name,
                    tool_args: event.tool_args,
                    status: 'running',
                  },
                  created_at: new Date().toISOString(),
                });
                // Mark rebuttal target files when write_brief_section starts
                if (
                  event.tool_name === 'write_brief_section' &&
                  event.tool_args?.relevant_file_ids
                ) {
                  useBriefStore
                    .getState()
                    .setRebuttalTargetFileIds(event.tool_args.relevant_file_ids as string[]);
                }
                break;

              case 'tool_result': {
                const existing = get().messages.find((m) => m.id === event.message_id);
                updateMessage(event.message_id, {
                  metadata: {
                    ...existing?.metadata,
                    tool_name: event.tool_name,
                    result_summary: event.result_summary,
                    success: event.success,
                    status: 'done',
                  },
                });
                // Add a tool_result message so expanded view works during streaming
                addMessage({
                  id: event.message_id + '_result',
                  role: 'tool_result',
                  content: event.result_summary,
                  metadata: {
                    tool_call_id: event.message_id,
                    tool_name: event.tool_name,
                    success: event.success,
                  },
                  created_at: new Date().toISOString(),
                });
                break;
              }

              case 'pipeline_progress': {
                // Attach steps to the most recent running tool_call
                const allMsgs = get().messages;
                for (let i = allMsgs.length - 1; i >= 0; i--) {
                  if (
                    allMsgs[i].role === 'tool_call' &&
                    allMsgs[i].metadata?.status === 'running'
                  ) {
                    updateMessage(allMsgs[i].id, {
                      metadata: { ...allMsgs[i].metadata, pipeline_steps: event.steps },
                    });
                    break;
                  }
                }
                break;
              }

              case 'progress':
                setAgentProgress({ current: event.current, total: event.total });
                break;

              case 'usage':
                setTokenUsage({
                  prompt_tokens: event.prompt_tokens,
                  completion_tokens: event.completion_tokens,
                  total_tokens: event.total_tokens,
                  estimated_cost_ntd: event.estimated_cost_ntd,
                });
                break;

              case 'brief_update': {
                if (rewindTargetId) {
                  useRewindStore.getState().markHasChanges(rewindTargetId);
                }
                const briefStore = useBriefStore.getState();
                const analysisStore = useAnalysisStore.getState();
                if (event.action === 'create_brief') {
                  const newBrief = event.data as Brief;
                  briefStore.setBriefs([...briefStore.briefs, newBrief]);
                  briefStore.setCurrentBrief(newBrief);
                  useTabStore
                    .getState()
                    .openBriefTab(newBrief.id, newBrief.title || newBrief.brief_type);
                } else if (event.action === 'add_paragraph') {
                  const p = event.data as Paragraph;
                  const briefId = (event as Record<string, unknown>).brief_id as string | undefined;
                  if (!briefId || briefStore.currentBrief?.id === briefId) {
                    briefStore.addParagraph(p);
                  }
                } else if (event.action === 'update_paragraph') {
                  const p = event.data as Paragraph;
                  const briefId = (event as Record<string, unknown>).brief_id as string | undefined;
                  if (!briefId || briefStore.currentBrief?.id === briefId) {
                    briefStore.updateParagraph(p.id, p);
                  }
                } else if (event.action === 'set_disputes') {
                  analysisStore.setDisputes(event.data as Dispute[]);
                } else if (event.action === 'set_damages') {
                  analysisStore.setDamages(event.data as Damage[]);
                } else if (event.action === 'set_law_refs') {
                  briefStore.setLawRefs(event.data as LawRef[]);
                } else if (event.action === 'set_timeline') {
                  analysisStore.setTimeline(event.data as TimelineEvent[]);
                } else if (event.action === 'set_parties') {
                  analysisStore.setParties(event.data as Party[]);
                } else if (event.action === 'set_claims') {
                  analysisStore.setClaims(event.data as ClaimGraph[]);
                }
                break;
              }

              case 'suggested_actions': {
                // Attach actions to the last assistant message
                const msgs = get().messages;
                for (let i = msgs.length - 1; i >= 0; i--) {
                  if (msgs[i].role === 'assistant') {
                    updateMessage(msgs[i].id, {
                      metadata: {
                        ...msgs[i].metadata,
                        suggested_actions: event.actions,
                      },
                    });
                    break;
                  }
                }
                break;
              }

              case 'error':
                setError(event.message);
                break;

              case 'done':
                break;
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      setIsStreaming(false);
      setAgentProgress(null);
      set({ _abortController: null });
      // Clear rebuttal targets when done
      useBriefStore.getState().setRebuttalTargetFileIds([]);
    }
  },

  cancelChat: async (caseId: string) => {
    const { _abortController } = get();
    if (_abortController) {
      _abortController.abort();
    }
    try {
      const token = useAuthStore.getState().token;
      await fetch(`/api/cases/${caseId}/chat/cancel`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // Ignore cancel errors
    }
    set({ isStreaming: false, agentProgress: null, _abortController: null });
  },

  clearConversation: async (caseId: string) => {
    try {
      const token = useAuthStore.getState().token;
      await fetch(`/api/cases/${caseId}/messages`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch (err) {
      console.error('clearConversation error:', err);
    }
    useRewindStore.getState().clear();
    set({ messages: [], tokenUsage: null, error: null, agentProgress: null });
  },
}));
