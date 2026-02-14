import { eq, sql } from "drizzle-orm";
import { lawRefs } from "../../db/schema";
import { searchLaw } from "../../lib/lawSearch";
import type { ToolHandler } from "./types";

export const handleSearchLaw: ToolHandler = async (
  args,
  caseId,
  _db,
  drizzle,
  ctx,
) => {
  if (!ctx) {
    return { result: "Error: missing execution context", success: false };
  }

  const query = args.query as string;
  const limit = (args.limit as number) || 10;
  if (!query) {
    return { result: "Error: query is required", success: false };
  }

  const results = await searchLaw(ctx.mongoUrl, { query, limit });

  if (results.length === 0) {
    return { result: `未找到與「${query}」相關的法條。`, success: true };
  }

  // Upsert into D1 law_refs table (single query per result via ON CONFLICT)
  for (const r of results) {
    try {
      await drizzle
        .insert(lawRefs)
        .values({
          id: r._id,
          case_id: caseId,
          law_name: r.law_name,
          article: r.article_no,
          title: `${r.law_name} ${r.article_no}`,
          full_text: r.content,
          usage_count: 1,
        })
        .onConflictDoUpdate({
          target: lawRefs.id,
          set: { usage_count: sql`coalesce(${lawRefs.usage_count}, 0) + 1` },
        });
    } catch {
      /* skip on error */
    }
  }

  // Read all law_refs for this case to send to frontend
  const allRefs = await drizzle
    .select()
    .from(lawRefs)
    .where(eq(lawRefs.case_id, caseId));

  await ctx.sendSSE({
    type: "brief_update",
    brief_id: "",
    action: "set_law_refs",
    data: allRefs,
  });

  // Format result text (include IDs so agent can pass them to write_brief_section)
  const formatted = results
    .map(
      (r) =>
        `[${r._id}] ${r.law_name} ${r.article_no}：${r.content.slice(0, 80)}${r.content.length > 80 ? "..." : ""}`,
    )
    .join("\n");

  return {
    result: `找到 ${results.length} 條相關法條：\n${formatted}\n\n（方括號內為法條 ID，撰寫書狀時請傳入 relevant_law_ids 參數）`,
    success: true,
  };
};
