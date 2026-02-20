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

export const handleAnalyzeDisputes = createAnalysisTool<DisputeItem>({
  fileContextOptions: { includeClaims: true },

  buildPrompt: (
    fileContext,
  ) => `你是專業的台灣法律分析助手。請根據以下案件文件摘要，分析雙方的爭點。

${fileContext}

請以 JSON 格式回傳爭點列表，格式如下：
[
  {
    "number": 1,
    "title": "爭點標題",
    "our_position": "我方立場",
    "their_position": "對方立場",
    "evidence": ["相關證據1", "相關證據2"],
    "law_refs": ["民法第XXX條"]
  }
]

重要：絕對不要使用 emoji 或特殊符號（如 ✅❌🔷📄⚖️💰🔨 等），只用純中文文字和標點符號。
只回傳 JSON 陣列，不要其他文字。`,

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
