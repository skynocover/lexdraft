import { eq } from 'drizzle-orm';
import { cases } from '../../db/schema';
import {
  toolError,
  loadReadyFiles,
  buildFileContext,
  callAnalysisAI,
  parseLLMJsonArray,
} from '../toolHelpers';
import type { ToolHandler, ToolContext, ToolResult } from './types';

interface TimelineItem {
  date: string;
  title: string;
  description: string;
  source_file: string;
  is_critical: boolean;
}

const buildPrompt = (
  fileContext: string,
) => `你是專業的台灣法律分析助手。請根據以下案件文件摘要，產生時間軸事件列表。

${fileContext}

請以 JSON 格式回傳時間軸事件列表，格式如下：
[
  {
    "date": "2024-01-15",
    "title": "事件標題",
    "description": "事件詳細描述",
    "source_file": "來源檔案名稱",
    "is_critical": true
  }
]

規則：
- date 格式為 YYYY-MM-DD，若只知年月則為 YYYY-MM-01，若只知年則為 YYYY-01-01
- is_critical 為布林值，標記關鍵事件（如起訴、判決、簽約、違約等）
- 按日期從早到晚排序
- 重要：絕對不要使用 emoji 或特殊符號
- 只回傳 JSON 陣列，不要其他文字。`;

export const handleGenerateTimeline: ToolHandler = async (
  _args: Record<string, unknown>,
  caseId: string,
  db: D1Database,
  drizzle,
  ctx?: ToolContext,
): Promise<ToolResult> => {
  if (!ctx) {
    return toolError('Error: missing execution context');
  }

  // 1. Load all ready files
  let readyFiles;
  try {
    readyFiles = await loadReadyFiles(db, caseId);
  } catch (e) {
    return e as ToolResult;
  }

  // 2. Build context + prompt → call AI
  const fileContext = buildFileContext(readyFiles, { includeDocDate: true });
  const prompt = buildPrompt(fileContext);
  const responseText = await callAnalysisAI(ctx.aiEnv, prompt);

  // 3. Parse JSON array from response
  let items: TimelineItem[];
  try {
    items = parseLLMJsonArray<TimelineItem>(responseText, '無法解析時間軸結果');
  } catch {
    return toolError('無法解析時間軸結果');
  }

  if (!items.length) {
    return { result: '未能從檔案中識別出時間軸事件。', success: false };
  }

  // 4. Sort by date
  items.sort((a, b) => a.date.localeCompare(b.date));

  // 5. Persist to cases.timeline JSON column
  await drizzle
    .update(cases)
    .set({ timeline: JSON.stringify(items) })
    .where(eq(cases.id, caseId));

  // 6. Send SSE notification
  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_timeline',
    data: items,
  });

  const summary = items
    .map((e) => `${e.date} ${e.title}${e.is_critical ? ' (關鍵)' : ''}`)
    .join('\n');
  return { result: `已產生 ${items.length} 個時間軸事件：\n${summary}`, success: true };
};
