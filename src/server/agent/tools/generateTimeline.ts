import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { timelineEvents as timelineEventsTable } from '../../db/schema';
import {
  toolError,
  loadReadyFiles,
  buildFileContext,
  callAnalysisAI,
  parseLLMJsonArray,
} from '../toolHelpers';
import type { ToolHandler } from './types';

interface TimelineItem {
  date: string;
  title: string;
  description: string;
  source_file: string;
  is_critical: boolean;
}

export const handleGenerateTimeline: ToolHandler = async (_args, caseId, db, drizzle, ctx) => {
  if (!ctx) {
    return toolError('Error: missing execution context');
  }

  // Load all ready files with summaries
  let timelineReadyFiles;
  try {
    timelineReadyFiles = await loadReadyFiles(db, caseId);
  } catch (e) {
    return e as { result: string; success: false };
  }

  const fileContext = buildFileContext(timelineReadyFiles, { includeDocDate: true });

  const timelinePrompt = `你是專業的台灣法律分析助手。請根據以下案件文件摘要，產生時間軸事件列表。

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

  const timelineResponseText = await callAnalysisAI(ctx.aiEnv, timelinePrompt);

  let timelineEvents: TimelineItem[] = [];
  try {
    timelineEvents = parseLLMJsonArray<TimelineItem>(timelineResponseText, '無法解析時間軸結果');
  } catch {
    return toolError('無法解析時間軸結果');
  }

  if (!timelineEvents.length) {
    return { result: '未能從檔案中識別出時間軸事件。', success: false };
  }

  // Sort by date
  timelineEvents.sort((a, b) => a.date.localeCompare(b.date));

  // Persist to D1 — delete old events for this case, then insert new ones
  await drizzle.delete(timelineEventsTable).where(eq(timelineEventsTable.case_id, caseId));
  const now = new Date().toISOString();
  if (timelineEvents.length) {
    await drizzle.insert(timelineEventsTable).values(
      timelineEvents.map((evt) => ({
        id: nanoid(),
        case_id: caseId,
        date: evt.date,
        title: evt.title,
        description: evt.description || '',
        source_file: evt.source_file || '',
        is_critical: evt.is_critical || false,
        created_at: now,
      })),
    );
  }

  // Send via SSE
  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_timeline',
    data: timelineEvents,
  });

  const timelineSummary = timelineEvents
    .map((e) => `${e.date} ${e.title}${e.is_critical ? ' (關鍵)' : ''}`)
    .join('\n');

  return {
    result: `已產生 ${timelineEvents.length} 個時間軸事件：\n${timelineSummary}`,
    success: true,
  };
};
