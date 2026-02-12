import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'
import type { AppEnv } from '../types'
import { getDB } from '../db'
import { messages } from '../db/schema'
import type { ChatMessageRecord } from '../../shared/types'

const chatRouter = new Hono<AppEnv>()

// POST /api/cases/:caseId/chat — Chat streaming (SSE)
chatRouter.post('/cases/:caseId/chat', async (c) => {
  const caseId = c.req.param('caseId')
  const body = await c.req.json<{ message: string }>()

  if (!body.message?.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }

  // Get DO stub by caseId
  const id = c.env.AGENT_DO.idFromName(caseId)
  const stub = c.env.AGENT_DO.get(id)

  // Forward to DO /chat with caseId in body
  const doResponse = await stub.fetch(new Request('https://do/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: body.message, caseId }),
  }))

  // Pipe SSE response through (zero buffering)
  return new Response(doResponse.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// POST /api/cases/:caseId/chat/cancel — Cancel Agent loop
chatRouter.post('/cases/:caseId/chat/cancel', async (c) => {
  const caseId = c.req.param('caseId')
  const id = c.env.AGENT_DO.idFromName(caseId)
  const stub = c.env.AGENT_DO.get(id)

  const doResponse = await stub.fetch(new Request('https://do/cancel', {
    method: 'POST',
  }))

  const result = await doResponse.json()
  return c.json(result)
})

// GET /api/cases/:caseId/messages — Chat history
chatRouter.get('/cases/:caseId/messages', async (c) => {
  const caseId = c.req.param('caseId')
  const db = getDB(c.env.DB)

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.case_id, caseId))
    .orderBy(asc(messages.created_at))

  const result: ChatMessageRecord[] = rows.map((row) => ({
    id: row.id,
    case_id: row.case_id,
    role: row.role as ChatMessageRecord['role'],
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    created_at: row.created_at || '',
  }))

  return c.json(result)
})

// DELETE /api/cases/:caseId/messages — Clear conversation
chatRouter.delete('/cases/:caseId/messages', async (c) => {
  const caseId = c.req.param('caseId')
  const db = getDB(c.env.DB)

  await db.delete(messages).where(eq(messages.case_id, caseId))

  return c.json({ ok: true })
})

export { chatRouter }
