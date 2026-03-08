import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { damages } from '../../db/schema';
import { createAnalysisTool } from './analysisFactory';

interface DamageItem {
  category: string;
  description: string;
  amount: number;
  basis: string;
}

export const DAMAGES_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      category: { type: 'STRING', enum: ['財產上損害', '非財產上損害'] },
      description: { type: 'STRING' },
      amount: { type: 'INTEGER' },
      basis: { type: 'STRING' },
    },
    required: ['category', 'description', 'amount', 'basis'],
  },
};

export const handleCalculateDamages = createAnalysisTool<DamageItem>({
  responseSchema: DAMAGES_SCHEMA,

  buildPrompt: (fileContext) => `請根據以下案件文件摘要，計算各項請求金額明細。

${fileContext}

category 只能是以下兩種之一：
- "財產上損害"：醫療費用、交通費用、工作損失、財物損害、貨款、利息、違約金等
- "非財產上損害"：精神慰撫金等
description 為該項目的具體名稱。
amount 為整數，以新台幣元計。如果文件中的「主張」欄位有列出明確金額，直接使用該精確金額。
重要：
- 不要使用 emoji 或特殊符號
- 不要包含「總計」或「合計」項目，只列出個別金額項目`,

  parseErrorLabel: '無法解析金額計算結果',
  emptyMessage: '未能識別出請求金額項目，請確認檔案已正確處理。',

  persistAndNotify: async (items, caseId, drizzle, sendSSE) => {
    await drizzle.delete(damages).where(eq(damages.case_id, caseId));

    const records = items.map((d) => ({
      id: nanoid(),
      case_id: caseId,
      category: d.category,
      description: d.description || null,
      amount: d.amount,
      basis: d.basis || null,
      evidence_refs: null,
      dispute_id: null,
      created_at: new Date().toISOString(),
    }));

    if (records.length) {
      await drizzle.insert(damages).values(records);
    }

    await sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_damages',
      data: records,
    });

    const totalAmount = records.reduce((sum, d) => sum + d.amount, 0);
    return `已計算 ${records.length} 項金額，請求總額 NT$ ${totalAmount.toLocaleString()}`;
  },
});
