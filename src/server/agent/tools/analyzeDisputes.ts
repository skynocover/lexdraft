import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { disputes } from '../../db/schema';
import { createAnalysisTool } from './analysisFactory';

interface DisputeItem {
  number: number;
  title: string;
  our_position: string;
  their_position: string;
  evidence: string[];
  law_refs: string[];
}

export const DISPUTES_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      number: { type: 'INTEGER' },
      title: { type: 'STRING' },
      our_position: { type: 'STRING' },
      their_position: { type: 'STRING' },
      evidence: { type: 'ARRAY', items: { type: 'STRING' } },
      law_refs: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['number', 'title', 'our_position', 'their_position', 'evidence', 'law_refs'],
  },
};

export const handleAnalyzeDisputes = createAnalysisTool<DisputeItem>({
  responseSchema: DISPUTES_SCHEMA,

  buildPrompt: (fileContext) => `請根據以下案件文件摘要，分析雙方的爭點。

${fileContext}

請回傳爭點列表。
- number：爭點編號（從 1 開始）
- title：爭點標題
- our_position：我方立場
- their_position：對方立場
- evidence：相關證據列表
- law_refs：相關法條列表（如「民法第XXX條」）

重要：不要使用 emoji 或特殊符號（如 ✅❌🔷📄⚖️💰🔨 等），只用純中文文字和標點符號。`,

  parseErrorLabel: '無法解析爭點分析結果',
  emptyMessage: '未能識別出爭點，請確認檔案已正確處理。',

  persistAndNotify: async (items, caseId, drizzle, sendSSE) => {
    await drizzle.delete(disputes).where(eq(disputes.case_id, caseId));

    const records = items.map((d) => ({
      id: nanoid(),
      case_id: caseId,
      number: d.number,
      title: d.title,
      our_position: d.our_position,
      their_position: d.their_position,
      evidence: JSON.stringify(d.evidence || []),
      law_refs: JSON.stringify(d.law_refs || []),
    }));

    if (records.length) {
      await drizzle.insert(disputes).values(records);
    }

    await sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_disputes',
      data: records.map((r) => ({
        ...r,
        evidence: JSON.parse(r.evidence),
        law_refs: JSON.parse(r.law_refs),
      })),
    });

    const summary = records.map((d) => `${d.number}. ${d.title}`).join('\n');
    return `已識別 ${records.length} 個爭點：\n${summary}`;
  },
});
