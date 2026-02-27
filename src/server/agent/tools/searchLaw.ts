import { searchLaw } from '../../lib/lawSearch';
import { ALIAS_MAP } from '../../lib/lawConstants';
import { toolError, toolSuccess } from '../toolHelpers';
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
    return toolError('缺少執行上下文');
  }

  const rawQuery = args.query as string;
  const lawName = args.law_name as string | undefined;
  const limit = (args.limit as number) || 10;
  if (!rawQuery) {
    return toolError('query 為必填');
  }

  const query = preprocessQuery(rawQuery);
  const results = await searchLaw(ctx.mongoUrl, {
    query,
    limit,
    apiKey: ctx.mongoApiKey,
    lawName,
  });

  if (results.length === 0) {
    return toolSuccess(`未找到與「${query}」相關的法條。`);
  }

  const formatted = results
    .map(
      (r) =>
        `[${r._id}] ${r.law_name} ${r.article_no}：${r.content.slice(0, 80)}${r.content.length > 80 ? '...' : ''}`,
    )
    .join('\n');

  return toolSuccess(`找到 ${results.length} 條相關法條：\n${formatted}`);
};
