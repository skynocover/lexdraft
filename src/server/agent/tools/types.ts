import type { AIEnv } from '../aiClient'
import type { SSEEvent } from '../../../shared/types'

export interface ToolContext {
  sendSSE: (event: SSEEvent) => Promise<void>
  aiEnv: AIEnv
  mongoUrl: string
}

export type ToolResult = { result: string; success: boolean }

export type ToolHandler = (
  args: Record<string, unknown>,
  caseId: string,
  db: D1Database,
  drizzle: ReturnType<typeof import('../../db').getDB>,
  ctx?: ToolContext,
) => Promise<ToolResult>
