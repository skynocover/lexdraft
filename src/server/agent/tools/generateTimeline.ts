import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { cases } from '../../db/schema';
import { createAnalysisTool } from './analysisFactory';

interface TimelineItem {
  id?: string;
  date: string;
  title: string;
  description: string;
  is_critical: boolean;
}

export const TIMELINE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING' },
      title: { type: 'STRING' },
      description: { type: 'STRING' },
      is_critical: { type: 'BOOLEAN' },
    },
    required: ['date', 'title', 'description', 'is_critical'],
  },
};

export const handleGenerateTimeline = createAnalysisTool<TimelineItem>({
  fileContextOptions: { includeDocDate: true },
  responseSchema: TIMELINE_SCHEMA,

  buildPrompt: (fileContext) => `請根據以下案件文件摘要，產生時間軸事件列表。

${fileContext}

規則：
- date 格式為 YYYY-MM-DD，若只知年月則為 YYYY-MM-01，若只知年則為 YYYY-01-01
- 只使用文件中明確提及的日期，不要推測或虛構日期
- is_critical 標記法律程序關鍵節點（起訴、判決、鑑定、調解等），一般就醫或休養不算 critical
- 按日期從早到晚排序
- 不要使用 emoji 或特殊符號`,

  parseErrorLabel: '無法解析時間軸結果',
  emptyMessage: '未能從檔案中識別出時間軸事件。',

  preProcess: (items) => {
    items.sort((a, b) => a.date.localeCompare(b.date));
    items.forEach((item) => {
      if (!item.id) item.id = nanoid();
    });
    return items;
  },

  persistAndNotify: async (items, caseId, drizzle, sendSSE) => {
    await drizzle
      .update(cases)
      .set({ timeline: JSON.stringify(items) })
      .where(eq(cases.id, caseId));

    await sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_timeline',
      data: items,
    });

    return `已產生 ${items.length} 個時間軸事件`;
  },
});
