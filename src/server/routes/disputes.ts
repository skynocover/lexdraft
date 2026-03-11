import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDB } from '../db';
import { disputes, claims } from '../db/schema';
import type { AppEnv } from '../types';
import { badRequest, notFound } from '../lib/errors';

const disputesRouter = new Hono<AppEnv>();

// PATCH /api/cases/:caseId/disputes/:id — 更新爭點標題
disputesRouter.patch('/cases/:caseId/disputes/:id', async (c) => {
  const caseId = c.req.param('caseId');
  const id = c.req.param('id');
  const body = await c.req.json<{ title?: string }>();
  const db = getDB(c.env.DB);

  if (!body.title?.trim()) {
    throw badRequest('標題不可為空');
  }

  const rows = await db
    .select()
    .from(disputes)
    .where(and(eq(disputes.id, id), eq(disputes.case_id, caseId)));

  if (!rows.length) throw notFound('爭點');

  await db.update(disputes).set({ title: body.title.trim() }).where(eq(disputes.id, id));

  const updated = { ...rows[0], title: body.title.trim() };
  return c.json({
    ...updated,
    evidence: updated.evidence ? JSON.parse(updated.evidence) : [],
    law_refs: updated.law_refs ? JSON.parse(updated.law_refs) : [],
    facts: updated.facts ? JSON.parse(updated.facts) : [],
  });
});

// DELETE /api/cases/:caseId/disputes/:id — 刪除爭點（cascade delete claims）
disputesRouter.delete('/cases/:caseId/disputes/:id', async (c) => {
  const caseId = c.req.param('caseId');
  const id = c.req.param('id');
  const db = getDB(c.env.DB);

  const rows = await db
    .select()
    .from(disputes)
    .where(and(eq(disputes.id, id), eq(disputes.case_id, caseId)));

  if (!rows.length) throw notFound('爭點');

  // 先刪 claims（FK 約束），再刪 dispute
  await db.delete(claims).where(eq(claims.dispute_id, id));
  await db.delete(disputes).where(eq(disputes.id, id));

  return c.json({ ok: true });
});

export { disputesRouter };
