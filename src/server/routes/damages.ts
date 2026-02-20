import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDB } from '../db'
import { damages } from '../db/schema'
import type { AppEnv } from '../types'
import { notFound } from '../lib/errors'

const damagesRouter = new Hono<AppEnv>()

// GET /api/cases/:caseId/damages — 列出案件所有金額項目
damagesRouter.get('/cases/:caseId/damages', async (c) => {
  const caseId = c.req.param('caseId')
  const db = getDB(c.env.DB)

  const rows = await db.select().from(damages).where(eq(damages.case_id, caseId))

  const parsed = rows.map((d) => ({
    ...d,
    evidence_refs: d.evidence_refs ? JSON.parse(d.evidence_refs) : [],
  }))

  return c.json(parsed)
})

// POST /api/cases/:caseId/damages — 新增金額項目
damagesRouter.post('/cases/:caseId/damages', async (c) => {
  const caseId = c.req.param('caseId')
  const body = await c.req.json<{
    category: string
    description?: string
    amount: number
    basis?: string
    evidence_refs?: string[]
    dispute_id?: string
  }>()
  const db = getDB(c.env.DB)

  const id = nanoid()
  const now = new Date().toISOString()

  await db.insert(damages).values({
    id,
    case_id: caseId,
    category: body.category,
    description: body.description || null,
    amount: body.amount,
    basis: body.basis || null,
    evidence_refs: body.evidence_refs ? JSON.stringify(body.evidence_refs) : null,
    dispute_id: body.dispute_id || null,
    created_at: now,
  })

  return c.json(
    {
      id,
      case_id: caseId,
      category: body.category,
      description: body.description || null,
      amount: body.amount,
      basis: body.basis || null,
      evidence_refs: body.evidence_refs || [],
      dispute_id: body.dispute_id || null,
      created_at: now,
    },
    201,
  )
})

// PUT /api/damages/:id — 更新金額項目
damagesRouter.put('/damages/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    category?: string
    description?: string
    amount?: number
    basis?: string
    evidence_refs?: string[]
    dispute_id?: string
  }>()
  const db = getDB(c.env.DB)

  const updates: Record<string, unknown> = {}
  if (body.category !== undefined) updates.category = body.category
  if (body.description !== undefined) updates.description = body.description
  if (body.amount !== undefined) updates.amount = body.amount
  if (body.basis !== undefined) updates.basis = body.basis
  if (body.evidence_refs !== undefined) updates.evidence_refs = JSON.stringify(body.evidence_refs)
  if (body.dispute_id !== undefined) updates.dispute_id = body.dispute_id

  await db.update(damages).set(updates).where(eq(damages.id, id))

  const rows = await db.select().from(damages).where(eq(damages.id, id))
  if (!rows.length) throw notFound('金額項目')

  const row = rows[0]
  return c.json({
    ...row,
    evidence_refs: row.evidence_refs ? JSON.parse(row.evidence_refs) : [],
  })
})

// DELETE /api/damages/:id — 刪除金額項目
damagesRouter.delete('/damages/:id', async (c) => {
  const id = c.req.param('id')
  const db = getDB(c.env.DB)

  await db.delete(damages).where(eq(damages.id, id))

  return c.json({ ok: true })
})

export { damagesRouter }
