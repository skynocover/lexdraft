import { Hono } from 'hono'
import type { AppEnv } from '../types'

const chatRouter = new Hono<AppEnv>()

// POST /api/cases/:caseId/chat — 聊天（SSE streaming）
chatRouter.post('/cases/:caseId/chat', async (c) => {
  return c.json({ message: 'TODO: chat' }, 501)
})

// POST /api/cases/:caseId/chat/cancel — 取消 Agent loop
chatRouter.post('/cases/:caseId/chat/cancel', async (c) => {
  return c.json({ message: 'TODO: cancel chat' }, 501)
})

// GET /api/cases/:caseId/messages — 聊天記錄
chatRouter.get('/cases/:caseId/messages', async (c) => {
  return c.json({ message: 'TODO: get messages' }, 501)
})

export { chatRouter }
