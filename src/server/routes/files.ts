import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { AppEnv } from '../types'
import { getDB } from '../db'
import { files } from '../db/schema'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const MAX_FILES_PER_CASE = 30

const filesRouter = new Hono<AppEnv>()

// POST /api/cases/:caseId/files — 上傳檔案
filesRouter.post('/cases/:caseId/files', async (c) => {
  const caseId = c.req.param('caseId')
  const db = getDB(c.env.DB)

  // 檢查檔案數量限制
  const existing = await db.select().from(files).where(eq(files.case_id, caseId))
  if (existing.length >= MAX_FILES_PER_CASE) {
    return c.json({ error: `每個案件最多 ${MAX_FILES_PER_CASE} 個檔案` }, 400)
  }

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return c.json({ error: '請選擇檔案' }, 400)
  }

  if (file.type !== 'application/pdf') {
    return c.json({ error: '僅支援 PDF 檔案' }, 400)
  }

  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: '檔案大小不可超過 20MB' }, 400)
  }

  const fileId = nanoid()
  const r2Key = `cases/${caseId}/${fileId}.pdf`
  const now = new Date().toISOString()

  // 存到 R2
  await c.env.BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType: 'application/pdf' },
  })

  // 寫入 D1 (status: pending)
  const newFile = {
    id: fileId,
    case_id: caseId,
    filename: file.name,
    r2_key: r2Key,
    file_size: file.size,
    mime_type: 'application/pdf',
    status: 'pending',
    category: null,
    doc_type: null,
    doc_date: null,
    full_text: null,
    summary: null,
    extracted_claims: null,
    created_at: now,
    updated_at: now,
  }

  await db.insert(files).values(newFile)

  // 丟 Queue message
  await c.env.FILE_QUEUE.send({
    fileId,
    caseId,
    r2Key,
    filename: file.name,
  })

  return c.json(newFile, 201)
})

// GET /api/cases/:caseId/files — 列出檔案
filesRouter.get('/cases/:caseId/files', async (c) => {
  const db = getDB(c.env.DB)
  const result = await db
    .select()
    .from(files)
    .where(eq(files.case_id, c.req.param('caseId')))
    .orderBy(files.created_at)
  return c.json(result)
})

// GET /api/cases/:caseId/files/status — 檔案處理狀態（polling）
filesRouter.get('/cases/:caseId/files/status', async (c) => {
  const db = getDB(c.env.DB)
  const result = await db
    .select({
      id: files.id,
      filename: files.filename,
      status: files.status,
      category: files.category,
      doc_type: files.doc_type,
    })
    .from(files)
    .where(eq(files.case_id, c.req.param('caseId')))

  const total = result.length
  const ready = result.filter((f) => f.status === 'ready').length
  const processing = result.filter((f) => f.status === 'processing').length
  const error = result.filter((f) => f.status === 'error').length

  return c.json({ total, ready, processing, error, files: result })
})

// PUT /api/files/:id — 更新檔案（手動修改分類等）
filesRouter.put('/files/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{
    category?: string
    doc_type?: string
    doc_date?: string
  }>()

  const db = getDB(c.env.DB)
  const existing = await db.select().from(files).where(eq(files.id, id))
  if (existing.length === 0) {
    return c.json({ error: '檔案不存在' }, 404)
  }

  const updates: Record<string, string | null> = { updated_at: new Date().toISOString() }
  if (body.category !== undefined) updates.category = body.category
  if (body.doc_type !== undefined) updates.doc_type = body.doc_type
  if (body.doc_date !== undefined) updates.doc_date = body.doc_date

  await db.update(files).set(updates).where(eq(files.id, id))
  const updated = await db.select().from(files).where(eq(files.id, id))
  return c.json(updated[0])
})

// DELETE /api/files/:id — 刪除檔案
filesRouter.delete('/files/:id', async (c) => {
  const id = c.req.param('id')
  const db = getDB(c.env.DB)

  const existing = await db.select().from(files).where(eq(files.id, id))
  if (existing.length === 0) {
    return c.json({ error: '檔案不存在' }, 404)
  }

  // 從 R2 刪除
  await c.env.BUCKET.delete(existing[0].r2_key)
  // 從 D1 刪除
  await db.delete(files).where(eq(files.id, id))

  return c.json({ ok: true })
})

// GET /api/files/:id/pdf — 回傳原始 PDF
filesRouter.get('/files/:id/pdf', async (c) => {
  const db = getDB(c.env.DB)
  const result = await db.select().from(files).where(eq(files.id, c.req.param('id')))

  if (result.length === 0) {
    return c.json({ error: '檔案不存在' }, 404)
  }

  const file = result[0]
  const object = await c.env.BUCKET.get(file.r2_key)
  if (!object) {
    return c.json({ error: '檔案不存在於儲存空間' }, 404)
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
})

// GET /api/files/:id/content — 取得全文
filesRouter.get('/files/:id/content', async (c) => {
  const db = getDB(c.env.DB)
  const result = await db.select().from(files).where(eq(files.id, c.req.param('id')))

  if (result.length === 0) {
    return c.json({ error: '檔案不存在' }, 404)
  }

  const file = result[0]
  if (file.status !== 'ready' || !file.full_text) {
    return c.json({ error: '檔案尚未處理完成' }, 400)
  }

  return c.json({ id: file.id, filename: file.filename, full_text: file.full_text })
})

export { filesRouter }
