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

export const handleCalculateDamages = createAnalysisTool<DamageItem>({
  buildPrompt: (
    fileContext,
  ) => `你是專業的台灣法律分析助手。請根據以下案件文件摘要，計算各項請求金額明細。

${fileContext}

請以 JSON 格式回傳金額項目列表，格式如下：
[
  {
    "category": "財產上損害",
    "description": "醫療費用",
    "amount": 41550,
    "basis": "因交通事故受傷所生之醫療費用，依診斷證明書與損害賠償明細請求",
  }
]

category 只能是以下兩種之一：
- "財產上損害"：醫療費用、交通費用、工作損失、財物損害、貨款、利息、違約金等
- "非財產上損害"：精神慰撫金等
description 為該項目的具體名稱。
amount 為整數，以新台幣元計。
重要：
- 絕對不要使用 emoji 或特殊符號（如 ✅❌🔷📄⚖️💰🔨 等），只用純中文文字和標點符號
- 不要包含「總計」或「合計」項目，只列出個別金額項目
- 只回傳 JSON 陣列，不要其他文字`,

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
