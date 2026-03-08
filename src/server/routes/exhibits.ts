import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDB } from '../db';
import { exhibits, files } from '../db/schema';
import type { AppEnv } from '../types';
import { notFound } from '../lib/errors';
import { parseBody } from '../lib/validate';
import {
  createExhibitSchema,
  updateExhibitSchema,
  reorderExhibitsSchema,
} from '../schemas/exhibits';
import {
  buildExhibitLabel,
  deriveExhibitDescription,
  getMaxExhibitNumber,
  renumberExhibitPrefix,
} from '../lib/exhibitAssign';

const exhibitsRouter = new Hono<AppEnv>();

// ── Helpers ──

const withLabel = (row: {
  prefix: string | null;
  number: number | null;
  [key: string]: unknown;
}) => ({
  ...row,
  label: buildExhibitLabel(row.prefix, row.number),
});

// ── Routes ──

// GET /api/cases/:caseId/exhibits
exhibitsRouter.get('/cases/:caseId/exhibits', async (c) => {
  const caseId = c.req.param('caseId');
  const db = getDB(c.env.DB);

  const rows = await db
    .select()
    .from(exhibits)
    .where(eq(exhibits.case_id, caseId))
    .orderBy(exhibits.prefix, exhibits.number);

  return c.json(rows.map(withLabel));
});

// POST /api/cases/:caseId/exhibits — 手動新增
exhibitsRouter.post('/cases/:caseId/exhibits', async (c) => {
  const caseId = c.req.param('caseId');
  const body = parseBody(await c.req.json(), createExhibitSchema);
  const db = getDB(c.env.DB);

  // Check file exists
  const [file] = await db.select().from(files).where(eq(files.id, body.file_id));
  if (!file) throw notFound('檔案');

  // Find max number for this prefix
  const prefix = body.prefix || '甲證';
  const maxNum = await getMaxExhibitNumber(db, caseId, prefix);
  const number = maxNum + 1;

  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(exhibits).values({
    id,
    case_id: caseId,
    file_id: body.file_id,
    prefix,
    number,
    doc_type: body.doc_type || '影本',
    description: deriveExhibitDescription(file.summary),
    created_at: now,
  });

  const [row] = await db.select().from(exhibits).where(eq(exhibits.id, id));
  return c.json(withLabel(row), 201);
});

// PATCH /api/cases/:caseId/exhibits/reorder — 同 prefix 內重新排序
// NOTE: Must be registered BEFORE /:id to avoid Hono matching "reorder" as :id
exhibitsRouter.patch('/cases/:caseId/exhibits/reorder', async (c) => {
  const caseId = c.req.param('caseId');
  const body = parseBody(await c.req.json(), reorderExhibitsSchema);
  const db = getDB(c.env.DB);

  // Update numbers based on array order
  for (let i = 0; i < body.order.length; i++) {
    await db
      .update(exhibits)
      .set({ number: i + 1 })
      .where(eq(exhibits.id, body.order[i]));
  }

  // Return updated full list
  const rows = await db
    .select()
    .from(exhibits)
    .where(eq(exhibits.case_id, caseId))
    .orderBy(exhibits.prefix, exhibits.number);

  return c.json(rows.map(withLabel));
});

// PATCH /api/cases/:caseId/exhibits/:id — 更新單一 exhibit
exhibitsRouter.patch('/cases/:caseId/exhibits/:id', async (c) => {
  const id = c.req.param('id');
  const body = parseBody(await c.req.json(), updateExhibitSchema);
  const db = getDB(c.env.DB);

  const updates: Record<string, unknown> = {};
  if (body.prefix !== undefined) updates.prefix = body.prefix;
  if (body.number !== undefined) updates.number = body.number;
  if (body.doc_type !== undefined) updates.doc_type = body.doc_type;
  if (body.description !== undefined) updates.description = body.description;

  await db.update(exhibits).set(updates).where(eq(exhibits.id, id));

  const [row] = await db.select().from(exhibits).where(eq(exhibits.id, id));
  if (!row) throw notFound('證物');

  return c.json(withLabel(row));
});

// DELETE /api/cases/:caseId/exhibits/:id
exhibitsRouter.delete('/cases/:caseId/exhibits/:id', async (c) => {
  const caseId = c.req.param('caseId');
  const id = c.req.param('id');
  const db = getDB(c.env.DB);

  // Get the exhibit to know its prefix for renumbering
  const [row] = await db.select().from(exhibits).where(eq(exhibits.id, id));
  if (!row) throw notFound('證物');

  await db.delete(exhibits).where(eq(exhibits.id, id));

  // Renumber remaining exhibits with the same prefix
  if (row.prefix) {
    await renumberExhibitPrefix(db, caseId, row.prefix);
  }

  return c.json({ ok: true });
});

export { exhibitsRouter };
