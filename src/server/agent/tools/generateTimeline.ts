import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { timelineEvents as timelineEventsTable } from '../../db/schema';
import { createAnalysisTool } from './analysisFactory';

interface TimelineItem {
  date: string;
  title: string;
  description: string;
  source_file: string;
  is_critical: boolean;
}

export const handleGenerateTimeline = createAnalysisTool<TimelineItem>({
  fileContextOptions: { includeDocDate: true },

  buildPrompt: (
    fileContext,
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
- 只回傳 JSON 陣列，不要其他文字。`,

  parseErrorLabel: '無法解析時間軸結果',
  emptyMessage: '未能從檔案中識別出時間軸事件。',

  preProcess: (items) => items.sort((a, b) => a.date.localeCompare(b.date)),

  persistAndNotify: async (items, caseId, drizzle, sendSSE) => {
    await drizzle.delete(timelineEventsTable).where(eq(timelineEventsTable.case_id, caseId));

    const now = new Date().toISOString();
    if (items.length) {
      await drizzle.insert(timelineEventsTable).values(
        items.map((evt) => ({
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

    await sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_timeline',
      data: items,
    });

    const summary = items
      .map((e) => `${e.date} ${e.title}${e.is_critical ? ' (關鍵)' : ''}`)
      .join('\n');
    return `已產生 ${items.length} 個時間軸事件：\n${summary}`;
  },
});
