import { Hono } from "hono";
import { eq, and, inArray } from "drizzle-orm";
import { getDB } from "../db";
import { lawRefs, timelineEvents, cases } from "../db/schema";
import { asc } from "drizzle-orm";
import { searchLaw } from "../lib/lawSearch";
import type { AppEnv } from "../types";

const lawRouter = new Hono<AppEnv>();

// POST /api/law/search — MongoDB Atlas Search
lawRouter.post("/law/search", async (c) => {
  const body = await c.req.json<{
    query: string;
    limit?: number;
    nature?: string;
  }>();

  if (!body.query) {
    return c.json({ error: "missing query" }, 400);
  }

  const results = await searchLaw(c.env.MONGO_URL, {
    query: body.query,
    limit: body.limit,
    nature: body.nature,
  });

  return c.json({ query: body.query, total: results.length, results });
});

// GET /api/cases/:caseId/law-refs — only manual + cited refs
lawRouter.get("/cases/:caseId/law-refs", async (c) => {
  const caseId = c.req.param("caseId");
  const db = getDB(c.env.DB);

  const rows = await db
    .select()
    .from(lawRefs)
    .where(
      and(
        eq(lawRefs.case_id, caseId),
        inArray(lawRefs.source, ["manual", "cited"]),
      ),
    );

  return c.json(rows);
});

// POST /api/cases/:caseId/law-refs — add manual law refs
lawRouter.post("/cases/:caseId/law-refs", async (c) => {
  const caseId = c.req.param("caseId");
  const body = await c.req.json<{
    items: Array<{
      id: string;
      law_name: string;
      article: string;
      full_text: string;
    }>;
  }>();

  if (!body.items?.length) {
    return c.json({ error: "items required" }, 400);
  }

  const db = getDB(c.env.DB);
  const added = [];

  for (const item of body.items) {
    try {
      await db
        .insert(lawRefs)
        .values({
          id: item.id,
          case_id: caseId,
          law_name: item.law_name,
          article: item.article,
          title: `${item.law_name} ${item.article}`,
          full_text: item.full_text,
          usage_count: 0,
          source: "manual",
        })
        .onConflictDoUpdate({
          target: lawRefs.id,
          set: { source: "manual" },
        });
      added.push(item.id);
    } catch {
      /* skip duplicates */
    }
  }

  // Return all displayable refs
  const rows = await db
    .select()
    .from(lawRefs)
    .where(
      and(
        eq(lawRefs.case_id, caseId),
        inArray(lawRefs.source, ["manual", "cited"]),
      ),
    );

  return c.json(rows);
});

// DELETE /api/law-refs/:id — remove a manual law ref
lawRouter.delete("/law-refs/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDB(c.env.DB);

  await db
    .delete(lawRefs)
    .where(and(eq(lawRefs.id, id), eq(lawRefs.source, "manual")));

  return c.json({ ok: true });
});

// GET /api/cases/:caseId/timeline — D1 timeline_events for a case
lawRouter.get("/cases/:caseId/timeline", async (c) => {
  const caseId = c.req.param("caseId");
  const db = getDB(c.env.DB);

  const rows = await db
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.case_id, caseId))
    .orderBy(asc(timelineEvents.date));

  return c.json(rows);
});

// GET /api/cases/:caseId/parties — parties from case record
lawRouter.get("/cases/:caseId/parties", async (c) => {
  const caseId = c.req.param("caseId");
  const db = getDB(c.env.DB);

  const [caseRow] = await db
    .select({
      plaintiff: cases.plaintiff,
      defendant: cases.defendant,
    })
    .from(cases)
    .where(eq(cases.id, caseId));

  if (!caseRow) {
    return c.json({ error: "case not found" }, 404);
  }

  const parties = [];
  if (caseRow.plaintiff) {
    parties.push({ role: "plaintiff", name: caseRow.plaintiff });
  }
  if (caseRow.defendant) {
    parties.push({ role: "defendant", name: caseRow.defendant });
  }

  return c.json(parties);
});

export { lawRouter };
