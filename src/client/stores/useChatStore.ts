import { create } from 'zustand'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result'
  content: string
  metadata?: Record<string, unknown>
  created_at: string
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  agentProgress: { current: number; total: number } | null
  setMessages: (messages: ChatMessage[]) => void
  addMessage: (message: ChatMessage) => void
  setIsStreaming: (isStreaming: boolean) => void
  setAgentProgress: (progress: { current: number; total: number } | null) => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  agentProgress: null,
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setAgentProgress: (agentProgress) => set({ agentProgress }),
}))
