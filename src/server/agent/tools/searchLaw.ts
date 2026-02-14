import { searchLaw } from "../../lib/lawSearch";
import type { ToolHandler } from "./types";

export const handleSearchLaw: ToolHandler = async (
  args,
  _caseId,
  _db,
  _drizzle,
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
