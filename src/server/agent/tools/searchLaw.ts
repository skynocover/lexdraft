import { searchLaw } from '../../lib/lawSearch';
import { ALIAS_MAP } from '../../lib/lawConstants';
import type { ToolHandler } from './types';

/** Replace known aliases in a query string before sending to searchLaw */
const preprocessQuery = (query: string): string => {
  let processed = query;
  for (const [alias, fullName] of Object.entries(ALIAS_MAP)) {
    if (processed.includes(alias)) {
      processed = processed.replace(alias, fullName);
      break; // only replace the first match to avoid double-replacing
    }
  }
  return processed;
};

export const handleSearchLaw: ToolHandler = async (args, _caseId, _db, _drizzle, ctx) => {
  if (!ctx) {
    return { result: 'Error: missing execution context', success: false };
  }

  const rawQuery = args.query as string;
  const limit = (args.limit as number) || 10;
  if (!rawQuery) {
    return { result: 'Error: query is required', success: false };
  }

  const query = preprocessQuery(rawQuery);
  const results = await searchLaw(ctx.mongoUrl, { query, limit });

  if (results.length === 0) {
    return { result: `未找到與「${query}」相關的法條。`, success: true };
  }

  // Format result text (include IDs so agent can pass them to write_brief_section)
  const formatted = results
    .map(
      (r) =>
        `[${r._id}] ${r.law_name} ${r.article_no}：${r.content.slice(0, 80)}${r.content.length > 80 ? '...' : ''}`,
    )
    .join('\n');

  return {
    result: `找到 ${results.length} 條相關法條：\n${formatted}\n\n【下一步】你必須立即對需要引用這些法條的段落呼叫 write_brief_section，將上述方括號內的法條 ID 傳入 relevant_law_ids 參數。不要只搜尋而不更新書狀。`,
    success: true,
  };
};
