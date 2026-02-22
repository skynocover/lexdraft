import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDB } from '../db';
import { cases } from '../db/schema';
import type { AppEnv } from '../types';
import { notFound } from '../lib/errors';

interface TimelineItem {
  id: string;
  date: string;
  title: string;
  description: string;
  is_critical: boolean;
}

const timelineRouter = new Hono<AppEnv>();

const readTimeline = async (drizzle: ReturnType<typeof getDB>, caseId: string) => {
  const [row] = await drizzle
    .select({ timeline: cases.timeline })
    .from(cases)
    .where(eq(cases.id, caseId));

  if (!row) throw notFound('案件');

  const items: TimelineItem[] = row.timeline ? JSON.parse(row.timeline) : [];

  // Backfill id for legacy data
  let changed = false;
  for (const item of items) {
    if (!item.id) {
      item.id = nanoid();
      changed = true;
    }
  }

  if (changed) {
    await drizzle
      .update(cases)
      .set({ timeline: JSON.stringify(items) })
      .where(eq(cases.id, caseId));
  }

  return items;
};

const writeTimeline = async (
  drizzle: ReturnType<typeof getDB>,
  caseId: string,
  items: TimelineItem[],
) => {
  await drizzle
    .update(cases)
    .set({ timeline: JSON.stringify(items) })
    .where(eq(cases.id, caseId));
};

// GET /api/cases/:caseId/timeline
timelineRouter.get('/cases/:caseId/timeline', async (c) => {
  const caseId = c.req.param('caseId');
  const drizzle = getDB(c.env.DB);

  const items = await readTimeline(drizzle, caseId);
  return c.json(items);
});

// POST /api/cases/:caseId/timeline
timelineRouter.post('/cases/:caseId/timeline', async (c) => {
  const caseId = c.req.param('caseId');
  const body = await c.req.json<{
    date: string;
    title: string;
    description?: string;
    is_critical?: boolean;
  }>();
  const drizzle = getDB(c.env.DB);

  const items = await readTimeline(drizzle, caseId);

  const newItem: TimelineItem = {
    id: nanoid(),
    date: body.date,
    title: body.title,
    description: body.description || '',
    is_critical: body.is_critical ?? false,
  };

  items.push(newItem);
  items.sort((a, b) => a.date.localeCompare(b.date));

  await writeTimeline(drizzle, caseId, items);

  return c.json(newItem, 201);
});

// PUT /api/cases/:caseId/timeline/:eventId
timelineRouter.put('/cases/:caseId/timeline/:eventId', async (c) => {
  const caseId = c.req.param('caseId');
  const eventId = c.req.param('eventId');
  const body = await c.req.json<{
    date?: string;
    title?: string;
    description?: string;
    is_critical?: boolean;
  }>();
  const drizzle = getDB(c.env.DB);

  const items = await readTimeline(drizzle, caseId);
  const idx = items.findIndex((item) => item.id === eventId);
  if (idx === -1) throw notFound('時間軸事件');

  if (body.date !== undefined) items[idx].date = body.date;
  if (body.title !== undefined) items[idx].title = body.title;
  if (body.description !== undefined) items[idx].description = body.description;
  if (body.is_critical !== undefined) items[idx].is_critical = body.is_critical;

  items.sort((a, b) => a.date.localeCompare(b.date));

  await writeTimeline(drizzle, caseId, items);

  return c.json(items.find((item) => item.id === eventId));
});

// DELETE /api/cases/:caseId/timeline/:eventId
timelineRouter.delete('/cases/:caseId/timeline/:eventId', async (c) => {
  const caseId = c.req.param('caseId');
  const eventId = c.req.param('eventId');
  const drizzle = getDB(c.env.DB);

  const items = await readTimeline(drizzle, caseId);
  const filtered = items.filter((item) => item.id !== eventId);

  await writeTimeline(drizzle, caseId, filtered);

  return c.json({ ok: true });
});

export { timelineRouter };
