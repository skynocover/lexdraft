import { Hono } from 'hono'
import type { AppEnv } from '../types'

const briefsRouter = new Hono<AppEnv>()

// GET /api/cases/:caseId/briefs — 列出書狀
briefsRouter.get('/cases/:caseId/briefs', async (c) => {
  return c.json({ message: 'TODO: list briefs' }, 501)
})

// GET /api/briefs/:id — 取得書狀
briefsRouter.get('/briefs/:id', async (c) => {
  return c.json({ message: 'TODO: get brief' }, 501)
})

// PUT /api/briefs/:id — 更新書狀
briefsRouter.put('/briefs/:id', async (c) => {
  return c.json({ message: 'TODO: update brief' }, 501)
})

export { briefsRouter }
