import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDB } from '../db'
import { briefs, disputes } from '../db/schema'
import type { AppEnv } from '../types'

const briefsRouter = new Hono<AppEnv>()

// GET /api/cases/:caseId/briefs — 列出書狀
briefsRouter.get('/cases/:caseId/briefs', async (c) => {
  const caseId = c.req.param('caseId')
  const db = getDB(c.env.DB)

  const rows = await db
    .select({
      id: briefs.id,
      case_id: briefs.case_id,
      brief_type: briefs.brief_type,
      title: briefs.title,
      version: briefs.version,
      created_at: briefs.created_at,
      updated_at: briefs.updated_at,
    })
    .from(briefs)
    .where(eq(briefs.case_id, caseId))

  return c.json(rows)
})

// POST /api/cases/:caseId/briefs — 建立新書狀
briefsRouter.post('/cases/:caseId/briefs', async (c) => {
  const caseId = c.req.param('caseId')
  const body = await c.req.json<{ brief_type: string; title: string }>()
  const db = getDB(c.env.DB)

  const id = nanoid()
  const now = new Date().toISOString()

  await db.insert(briefs).values({
    id,
    case_id: caseId,
    brief_type: body.brief_type,
    title: body.title,
    content_structured: JSON.stringify({ paragraphs: [] }),
    version: 1,
    created_at: now,
    updated_at: now,
  })

  return c.json({
    id,
    case_id: caseId,
    brief_type: body.brief_type,
    title: body.title,
    content_structured: { paragraphs: [] },
    version: 1,
    created_at: now,
    updated_at: now,
  }, 201)
})

// GET /api/briefs/:id — 取得單一書狀（含 content_structured）
briefsRouter.get('/briefs/:id', async (c) => {
  const id = c.req.param('id')
  const db = getDB(c.env.DB)

  const rows = await db
    .select()
    .from(briefs)
    .where(eq(briefs.id, id))

  if (!rows.length) {
    return c.json({ error: 'Brief not found' }, 404)
  }

  const brief = rows[0]
  return c.json({
    ...brief,
    content_structured: brief.content_structured
      ? JSON.parse(brief.content_structured)
      : null,
  })
})

// PUT /api/briefs/:id — 更新書狀
briefsRouter.put('/briefs/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    title?: string
    content_structured?: unknown
    brief_type?: string
  }>()
  const db = getDB(c.env.DB)

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (body.title !== undefined) updates.title = body.title
  if (body.brief_type !== undefined) updates.brief_type = body.brief_type
  if (body.content_structured !== undefined) {
    updates.content_structured = JSON.stringify(body.content_structured)
  }

  await db
    .update(briefs)
    .set(updates)
    .where(eq(briefs.id, id))

  // Return updated brief
  const rows = await db.select().from(briefs).where(eq(briefs.id, id))
  if (!rows.length) {
    return c.json({ error: 'Brief not found' }, 404)
  }

  const brief = rows[0]
  return c.json({
    ...brief,
    content_structured: brief.content_structured
      ? JSON.parse(brief.content_structured)
      : null,
  })
})

// GET /api/cases/:caseId/disputes — 列出爭點
briefsRouter.get('/cases/:caseId/disputes', async (c) => {
  const caseId = c.req.param('caseId')
  const db = getDB(c.env.DB)

  const rows = await db
    .select()
    .from(disputes)
    .where(eq(disputes.case_id, caseId))

  const parsed = rows.map((d) => ({
    ...d,
    evidence: d.evidence ? JSON.parse(d.evidence) : [],
    law_refs: d.law_refs ? JSON.parse(d.law_refs) : [],
  }))

  return c.json(parsed)
})

export { briefsRouter }
