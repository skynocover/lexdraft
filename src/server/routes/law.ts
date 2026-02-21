import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDB } from '../db';
import { cases, claims } from '../db/schema';
import { searchLaw } from '../lib/lawSearch';
import { readLawRefs, upsertManyLawRefs, removeLawRef } from '../lib/lawRefsJson';
import type { AppEnv } from '../types';
import { notFound } from '../lib/errors';
import { requireString, requireArray } from '../lib/validate';

const lawRouter = new Hono<AppEnv>();

// POST /api/law/search — MongoDB Atlas Search
lawRouter.post('/law/search', async (c) => {
  const body = await c.req.json<{
    query: string;
    limit?: number;
    nature?: string;
  }>();

  requireString(body.query, '搜尋關鍵字');

  const results = await searchLaw(c.env.MONGO_URL, {
    query: body.query,
    limit: body.limit,
    nature: body.nature,
  });

  return c.json({ query: body.query, total: results.length, results });
});

// GET /api/cases/:caseId/law-refs
lawRouter.get('/cases/:caseId/law-refs', async (c) => {
  const caseId = c.req.param('caseId');
  const db = getDB(c.env.DB);

  const refs = await readLawRefs(db, caseId);

  return c.json(refs);
});

// POST /api/cases/:caseId/law-refs — add law refs
lawRouter.post('/cases/:caseId/law-refs', async (c) => {
  const caseId = c.req.param('caseId');
  const body = await c.req.json<{
    items: Array<{
      id: string;
      law_name: string;
      article: string;
      full_text: string;
    }>;
  }>();

  requireArray(body.items, '法條項目');

  const db = getDB(c.env.DB);
  const refs = body.items.map((item) => ({
    id: item.id,
    law_name: item.law_name,
    article: item.article,
    full_text: item.full_text,
    is_manual: true,
  }));

  const updated = await upsertManyLawRefs(db, caseId, refs);

  return c.json(updated);
});

// DELETE /api/cases/:caseId/law-refs/:id — remove a law ref
lawRouter.delete('/cases/:caseId/law-refs/:id', async (c) => {
  const caseId = c.req.param('caseId');
  const id = c.req.param('id');
  const db = getDB(c.env.DB);

  await removeLawRef(db, caseId, id);

  return c.json({ ok: true });
});

// GET /api/cases/:caseId/claims — claims for a case
lawRouter.get('/cases/:caseId/claims', async (c) => {
  const caseId = c.req.param('caseId');
  const db = getDB(c.env.DB);

  const rows = await db.select().from(claims).where(eq(claims.case_id, caseId));

  return c.json(rows);
});

// GET /api/cases/:caseId/timeline — read from cases.timeline JSON
lawRouter.get('/cases/:caseId/timeline', async (c) => {
  const caseId = c.req.param('caseId');
  const db = getDB(c.env.DB);

  const [row] = await db
    .select({ timeline: cases.timeline })
    .from(cases)
    .where(eq(cases.id, caseId));

  if (!row) throw notFound('案件');

  const items = row.timeline ? JSON.parse(row.timeline) : [];
  return c.json(items);
});

// GET /api/cases/:caseId/parties — parties from case record
lawRouter.get('/cases/:caseId/parties', async (c) => {
  const caseId = c.req.param('caseId');
  const db = getDB(c.env.DB);

  const [caseRow] = await db
    .select({
      plaintiff: cases.plaintiff,
      defendant: cases.defendant,
    })
    .from(cases)
    .where(eq(cases.id, caseId));

  if (!caseRow) throw notFound('案件');

  const parties = [];
  if (caseRow.plaintiff) {
    parties.push({ role: 'plaintiff', name: caseRow.plaintiff });
  }
  if (caseRow.defendant) {
    parties.push({ role: 'defendant', name: caseRow.defendant });
  }

  return c.json(parties);
});

export { lawRouter };
