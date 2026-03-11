import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDB } from '../db';
import { briefs, briefVersions, disputes } from '../db/schema';
import type { AppEnv } from '../types';
import { notFound } from '../lib/errors';
import { parseJsonField } from '../lib/jsonUtils';
import { parseBody } from '../lib/validate';
import { createBriefSchema, updateBriefSchema } from '../schemas/briefs';

const briefsRouter = new Hono<AppEnv>();

// GET /api/cases/:caseId/briefs — 列出書狀
briefsRouter.get('/cases/:caseId/briefs', async (c) => {
  const caseId = c.req.param('caseId');
  const db = getDB(c.env.DB);

  const rows = await db
    .select({
      id: briefs.id,
      case_id: briefs.case_id,
      template_id: briefs.template_id,
      title: briefs.title,
      version: briefs.version,
      created_at: briefs.created_at,
      updated_at: briefs.updated_at,
    })
    .from(briefs)
    .where(eq(briefs.case_id, caseId));

  return c.json(rows);
});

// POST /api/cases/:caseId/briefs — 建立新書狀
briefsRouter.post('/cases/:caseId/briefs', async (c) => {
  const caseId = c.req.param('caseId');
  const body = parseBody(await c.req.json(), createBriefSchema);
  const db = getDB(c.env.DB);

  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(briefs).values({
    id,
    case_id: caseId,
    template_id: body.template_id,
    title: body.title,
    content_structured: JSON.stringify({ paragraphs: [] }),
    version: 1,
    created_at: now,
    updated_at: now,
  });

  return c.json(
    {
      id,
      case_id: caseId,
      template_id: body.template_id,
      title: body.title,
      content_structured: { paragraphs: [] },
      version: 1,
      created_at: now,
      updated_at: now,
    },
    201,
  );
});

// GET /api/briefs/:id — 取得單一書狀（含 content_structured）
briefsRouter.get('/briefs/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDB(c.env.DB);

  const rows = await db.select().from(briefs).where(eq(briefs.id, id));

  if (!rows.length) throw notFound('書狀');

  const brief = rows[0];
  return c.json({
    ...brief,
    content_structured: brief.content_structured ? JSON.parse(brief.content_structured) : null,
  });
});

// PUT /api/briefs/:id — 更新書狀
briefsRouter.put('/briefs/:id', async (c) => {
  const id = c.req.param('id');
  const body = parseBody(await c.req.json(), updateBriefSchema);
  const db = getDB(c.env.DB);

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.title !== undefined) updates.title = body.title;
  if (body.template_id !== undefined) updates.template_id = body.template_id;
  if (body.content_structured !== undefined) {
    updates.content_structured = JSON.stringify(body.content_structured);
  }

  await db.update(briefs).set(updates).where(eq(briefs.id, id));

  // Return updated brief
  const rows = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!rows.length) throw notFound('書狀');

  const brief = rows[0];
  return c.json({
    ...brief,
    content_structured: brief.content_structured ? JSON.parse(brief.content_structured) : null,
  });
});

// DELETE /api/briefs/:id — 刪除書狀
briefsRouter.delete('/briefs/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDB(c.env.DB);

  // 先清除關聯的版本紀錄
  await db.delete(briefVersions).where(eq(briefVersions.brief_id, id));
  // 刪除書狀
  await db.delete(briefs).where(eq(briefs.id, id));

  return c.json({ ok: true });
});

// GET /api/cases/:caseId/disputes — 列出爭點
briefsRouter.get('/cases/:caseId/disputes', async (c) => {
  const caseId = c.req.param('caseId');
  const db = getDB(c.env.DB);

  const rows = await db.select().from(disputes).where(eq(disputes.case_id, caseId));

  const parsed = rows.map((d) => ({
    ...d,
    evidence: parseJsonField<string[]>(d.evidence, []),
    law_refs: parseJsonField<string[]>(d.law_refs, []),
  }));

  return c.json(parsed);
});

export { briefsRouter };
