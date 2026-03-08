import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../types';
import { getDB } from '../db';
import { templates } from '../db/schema';
import { notFound } from '../lib/errors';
import { parseBody } from '../lib/validate';
import { createTemplateSchema, updateTemplateSchema } from '../schemas/templates';
import { DEFAULT_TEMPLATES } from '../lib/defaultTemplates';

const templatesRouter = new Hono<AppEnv>();

// GET /api/templates — 列出所有範本（defaults + DB custom，不含 content_md）
templatesRouter.get('/templates', async (c) => {
  const db = getDB(c.env.DB);

  // 1. Hardcoded defaults (always present)
  const defaults = DEFAULT_TEMPLATES.map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category,
    is_default: 1,
    created_at: null as string | null,
    updated_at: null as string | null,
  }));

  // 2. DB custom templates
  const custom = await db
    .select({
      id: templates.id,
      title: templates.title,
      category: templates.category,
      is_default: templates.is_default,
      created_at: templates.created_at,
      updated_at: templates.updated_at,
    })
    .from(templates)
    .orderBy(desc(templates.updated_at));

  return c.json([...defaults, ...custom]);
});

// POST /api/templates — 新增自訂範本
templatesRouter.post('/templates', async (c) => {
  const body = parseBody(await c.req.json(), createTemplateSchema);

  const db = getDB(c.env.DB);

  const title = body.title?.trim() || '新範本';
  const contentMd = body.content_md ?? '';
  const category = body.category ?? null;

  const now = new Date().toISOString();
  const newTemplate = {
    id: nanoid(),
    title,
    category,
    content_md: contentMd,
    is_default: 0,
    created_at: now,
    updated_at: now,
  };

  await db.insert(templates).values(newTemplate);
  return c.json(newTemplate, 201);
});

// GET /api/templates/:id — 取得單一範本（含 content_md）
templatesRouter.get('/templates/:id', async (c) => {
  const id = c.req.param('id');

  // 檢查是否為 hardcoded default
  if (id.startsWith('default-')) {
    const dt = DEFAULT_TEMPLATES.find((t) => t.id === id);
    if (!dt) throw notFound('範本');
    return c.json({
      id: dt.id,
      title: dt.title,
      category: dt.category,
      content_md: dt.content_md,
      is_default: 1,
      created_at: null,
      updated_at: null,
    });
  }

  const db = getDB(c.env.DB);
  const result = await db.select().from(templates).where(eq(templates.id, id));
  if (result.length === 0) throw notFound('範本');
  return c.json(result[0]);
});

// PUT /api/templates/:id — 更新自訂範本
templatesRouter.put('/templates/:id', async (c) => {
  const id = c.req.param('id');

  // 不允許更新預設範本
  if (id.startsWith('default-')) {
    return c.json({ error: '系統預設範本不可修改' }, 403);
  }

  const body = parseBody(await c.req.json(), updateTemplateSchema);

  const db = getDB(c.env.DB);

  const updates: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (body.title !== undefined) updates.title = body.title;
  if (body.content_md !== undefined) updates.content_md = body.content_md;

  await db.update(templates).set(updates).where(eq(templates.id, id));

  const updated = await db.select().from(templates).where(eq(templates.id, id));
  if (updated.length === 0) throw notFound('範本');
  return c.json(updated[0]);
});

// DELETE /api/templates/:id — 刪除自訂範本
templatesRouter.delete('/templates/:id', async (c) => {
  const id = c.req.param('id');

  // 不允許刪除預設範本
  if (id.startsWith('default-')) {
    return c.json({ error: '系統預設範本不可刪除' }, 403);
  }

  const db = getDB(c.env.DB);
  const existing = await db.select().from(templates).where(eq(templates.id, id));
  if (existing.length === 0) throw notFound('範本');

  await db.delete(templates).where(eq(templates.id, id));
  return c.json({ ok: true });
});

export { templatesRouter };
