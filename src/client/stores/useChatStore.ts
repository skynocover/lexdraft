import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { api } from '../lib/api';
import { useAuthStore } from './useAuthStore';
import { useBriefStore } from './useBriefStore';
import { useRewindStore } from './useRewindStore';
import { handleSSEEvent, type SSEContext } from './sseHandlers';
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
  tokenUsage: TokenUsage | null;
  error: string | null;
  prefillInput: string | null;

  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (id: string, text: string) => void;
  clearMessages: () => void;
  setIsStreaming: (isStreaming: boolean) => void;
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
  clearMessages: () => set({ messages: [], tokenUsage: null, error: null }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setTokenUsage: (tokenUsage) => set({ tokenUsage }),
  setError: (error) => set({ error }),
  setPrefillInput: (prefillInput) => set({ prefillInput }),

  loadHistory: async (caseId: string) => {
    try {
      const data = await api.get<ChatMessageRecord[]>(`/cases/${caseId}/messages`);
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
    const { addMessage, appendToMessage, updateMessage, setIsStreaming, setTokenUsage, setError } =
      get();

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
      let sseCtx: SSEContext = { currentAssistantId: null, rewindTargetId: null };

      const sseActions = {
        addMessage,
        appendToMessage,
        updateMessage,
        setTokenUsage,
        setError,
        getMessages: () => get().messages,
      };

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
            sseCtx = handleSSEEvent(event, sseCtx, sseActions);
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
      await api.post(`/cases/${caseId}/chat/cancel`, {});
    } catch {
      // Ignore cancel errors
    }
    set({ isStreaming: false, _abortController: null });
  },

  clearConversation: async (caseId: string) => {
    try {
      await api.delete(`/cases/${caseId}/messages`);
    } catch (err) {
      console.error('clearConversation error:', err);
    }
    useRewindStore.getState().clear();
    set({ messages: [], tokenUsage: null, error: null });
  },
}));
