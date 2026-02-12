import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types'

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice(7)
  const expected = c.env.AUTH_TOKEN

  if (!expected || token !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})
