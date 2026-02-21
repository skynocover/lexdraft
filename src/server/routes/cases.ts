import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../types';
import { getDB } from '../db';
import {
  cases,
  users,
  files,
  briefs,
  briefVersions,
  disputes,
  damages,
  claims,
  timelineEvents,
  messages,
} from '../db/schema';
import { notFound } from '../lib/errors';
import { requireString } from '../lib/validate';

const DEFAULT_USER_ID = 'default-user';

/** MVP: 確保 default user 存在 */
async function ensureDefaultUser(db: ReturnType<typeof getDB>) {
  const existing = await db.select().from(users).where(eq(users.id, DEFAULT_USER_ID));
  if (existing.length === 0) {
    await db.insert(users).values({
      id: DEFAULT_USER_ID,
      email: 'admin@lexdraft.local',
      password_hash: 'not-used-in-mvp',
      name: 'Default User',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}

const casesRouter = new Hono<AppEnv>();

// GET /api/cases — 列出所有案件
casesRouter.get('/', async (c) => {
  const db = getDB(c.env.DB);
  const result = await db.select().from(cases).orderBy(cases.created_at);
  return c.json(result);
});

// POST /api/cases — 建立案件
casesRouter.post('/', async (c) => {
  const body = await c.req.json<{
    title: string;
    case_number?: string;
    court?: string;
    case_type?: string;
    plaintiff?: string;
    defendant?: string;
  }>();

  const title = requireString(body.title, '案件名稱');

  const db = getDB(c.env.DB);
  await ensureDefaultUser(db);
  const now = new Date().toISOString();
  const newCase = {
    id: nanoid(),
    user_id: DEFAULT_USER_ID,
    title,
    case_number: body.case_number?.trim() || null,
    court: body.court?.trim() || null,
    case_type: body.case_type?.trim() || null,
    plaintiff: body.plaintiff?.trim() || null,
    defendant: body.defendant?.trim() || null,
    created_at: now,
    updated_at: now,
  };

  await db.insert(cases).values(newCase);
  return c.json(newCase, 201);
});

// GET /api/cases/:id — 取得案件
casesRouter.get('/:id', async (c) => {
  const db = getDB(c.env.DB);
  const result = await db
    .select()
    .from(cases)
    .where(eq(cases.id, c.req.param('id')));

  if (result.length === 0) throw notFound('案件');

  return c.json(result[0]);
});

// PUT /api/cases/:id — 更新案件
casesRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    title?: string;
    case_number?: string;
    court?: string;
    case_type?: string;
    plaintiff?: string;
    defendant?: string;
  }>();

  const db = getDB(c.env.DB);
  const existing = await db.select().from(cases).where(eq(cases.id, id));

  if (existing.length === 0) throw notFound('案件');

  const updates: Record<string, string | null> = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.case_number !== undefined) updates.case_number = body.case_number.trim() || null;
  if (body.court !== undefined) updates.court = body.court.trim() || null;
  if (body.case_type !== undefined) updates.case_type = body.case_type.trim() || null;
  if (body.plaintiff !== undefined) updates.plaintiff = body.plaintiff.trim() || null;
  if (body.defendant !== undefined) updates.defendant = body.defendant.trim() || null;

  await db.update(cases).set(updates).where(eq(cases.id, id));

  const updated = await db.select().from(cases).where(eq(cases.id, id));
  return c.json(updated[0]);
});

// DELETE /api/cases/:id — 刪除案件及所有關聯資料
casesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const db = getDB(c.env.DB);

  const existing = await db.select().from(cases).where(eq(cases.id, id));
  if (existing.length === 0) throw notFound('案件');

  // 刪除 brief_versions（需先查出 brief ids）
  const briefRows = await db.select({ id: briefs.id }).from(briefs).where(eq(briefs.case_id, id));
  const briefIds = briefRows.map((b) => b.id);

  if (briefIds.length > 0) {
    await db.delete(briefVersions).where(inArray(briefVersions.brief_id, briefIds));
  }

  // 刪除其餘關聯資料
  await db.delete(claims).where(eq(claims.case_id, id));
  await db.delete(disputes).where(eq(disputes.case_id, id));
  await db.delete(damages).where(eq(damages.case_id, id));
  await db.delete(timelineEvents).where(eq(timelineEvents.case_id, id));
  await db.delete(messages).where(eq(messages.case_id, id));
  await db.delete(briefs).where(eq(briefs.case_id, id));

  // 刪除檔案記錄（R2 物件需另外清理）
  await db.delete(files).where(eq(files.case_id, id));

  // 刪除案件
  await db.delete(cases).where(eq(cases.id, id));

  return c.json({ ok: true });
});

export { casesRouter };
