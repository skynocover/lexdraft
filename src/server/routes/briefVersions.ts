import { Hono } from "hono";
import { eq, desc, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDB } from "../db";
import { briefs, briefVersions } from "../db/schema";
import type { AppEnv } from "../types";

const briefVersionsRouter = new Hono<AppEnv>();

// GET /api/briefs/:briefId/versions — 列出版本（不含 content，按 version_no DESC）
briefVersionsRouter.get("/briefs/:briefId/versions", async (c) => {
  const briefId = c.req.param("briefId");
  const db = getDB(c.env.DB);

  const rows = await db
    .select({
      id: briefVersions.id,
      brief_id: briefVersions.brief_id,
      version_no: briefVersions.version_no,
      label: briefVersions.label,
      created_at: briefVersions.created_at,
      created_by: briefVersions.created_by,
    })
    .from(briefVersions)
    .where(eq(briefVersions.brief_id, briefId))
    .orderBy(desc(briefVersions.version_no));

  return c.json(rows);
});

// POST /api/briefs/:briefId/versions — 建立新版本
briefVersionsRouter.post("/briefs/:briefId/versions", async (c) => {
  const briefId = c.req.param("briefId");
  const body = await c.req.json<{ label: string; created_by?: string }>();
  const db = getDB(c.env.DB);

  // 讀取當前 brief
  const briefRows = await db
    .select()
    .from(briefs)
    .where(eq(briefs.id, briefId));
  if (!briefRows.length) {
    return c.json({ error: "Brief not found" }, 404);
  }

  const brief = briefRows[0];
  if (!brief.content_structured) {
    return c.json({ error: "Brief has no content" }, 400);
  }

  // 計算 version_no
  const maxResult = await db
    .select({ maxNo: max(briefVersions.version_no) })
    .from(briefVersions)
    .where(eq(briefVersions.brief_id, briefId));

  const nextNo = (maxResult[0]?.maxNo ?? 0) + 1;

  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(briefVersions).values({
    id,
    brief_id: briefId,
    version_no: nextNo,
    label: body.label,
    content_structured: brief.content_structured,
    created_at: now,
    created_by: body.created_by || "user",
  });

  return c.json(
    {
      id,
      brief_id: briefId,
      version_no: nextNo,
      label: body.label,
      created_at: now,
      created_by: body.created_by || "user",
    },
    201,
  );
});

// GET /api/brief-versions/:id — 取得單一版本（含 content_structured）
briefVersionsRouter.get("/brief-versions/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDB(c.env.DB);

  const rows = await db
    .select()
    .from(briefVersions)
    .where(eq(briefVersions.id, id));

  if (!rows.length) {
    return c.json({ error: "Version not found" }, 404);
  }

  const version = rows[0];
  return c.json({
    ...version,
    content_structured: version.content_structured
      ? JSON.parse(version.content_structured)
      : null,
  });
});

// DELETE /api/brief-versions/:id — 刪除版本
briefVersionsRouter.delete("/brief-versions/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDB(c.env.DB);

  await db.delete(briefVersions).where(eq(briefVersions.id, id));

  return c.json({ success: true });
});

export { briefVersionsRouter };
