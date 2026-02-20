import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { damages } from '../../db/schema';
import {
  toolError,
  loadReadyFiles,
  buildFileContext,
  callAnalysisAI,
  parseLLMJsonArray,
} from '../toolHelpers';
import type { ToolHandler } from './types';

interface DamageItem {
  category: string;
  description: string;
  amount: number;
  basis: string;
  evidence_refs: string[];
}

export const handleCalculateDamages: ToolHandler = async (_args, caseId, db, drizzle, ctx) => {
  if (!ctx) {
    return toolError('Error: missing execution context');
  }

  // 1. Load all ready files with summaries
  let damageReadyFiles;
  try {
    damageReadyFiles = await loadReadyFiles(db, caseId);
  } catch (e) {
    return e as { result: string; success: false };
  }

  // Build context for AI
  const damageFileContext = buildFileContext(damageReadyFiles, {
    includeClaims: true,
    includeKeyAmounts: true,
  });

  // 2. Call AI for damage analysis
  const damagePrompt = `你是專業的台灣法律分析助手。請根據以下案件文件摘要，計算各項請求金額明細。

${damageFileContext}

請以 JSON 格式回傳金額項目列表，格式如下：
[
  {
    "category": "貨款",
    "description": "合約貨款尾款",
    "amount": 1200000,
    "basis": "依系爭買賣合約第5條",
    "evidence_refs": ["原證二"]
  }
]

金額 category 常見分類：貨款、利息、違約金、精神慰撫金、損害賠償、其他。
amount 為整數，以新台幣元計。
重要：絕對不要使用 emoji 或特殊符號（如 ✅❌🔷📄⚖️💰🔨 等），只用純中文文字和標點符號。
只回傳 JSON 陣列，不要其他文字。`;

  const damageResponseText = await callAnalysisAI(ctx.aiEnv, damagePrompt);

  // 3. Parse damages from response
  let damageList: DamageItem[] = [];
  try {
    damageList = parseLLMJsonArray<DamageItem>(damageResponseText, '無法解析金額計算結果');
  } catch {
    return toolError('無法解析金額計算結果');
  }

  if (!damageList.length) {
    return { result: '未能識別出請求金額項目，請確認檔案已正確處理。', success: false };
  }

  // 4. Clear old damages for this case, then write new ones
  await drizzle.delete(damages).where(eq(damages.case_id, caseId));
  const damageRecords = damageList.map((d) => ({
    id: nanoid(),
    case_id: caseId,
    category: d.category,
    description: d.description || null,
    amount: d.amount,
    basis: d.basis || null,
    evidence_refs: JSON.stringify(d.evidence_refs || []),
    dispute_id: null,
    created_at: new Date().toISOString(),
  }));

  if (damageRecords.length) {
    await drizzle.insert(damages).values(damageRecords);
  }

  // 5. Send SSE brief_update with set_damages
  const damageData = damageRecords.map((r) => ({
    ...r,
    evidence_refs: JSON.parse(r.evidence_refs),
  }));

  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_damages',
    data: damageData,
  });

  // 6. Return summary
  const totalAmount = damageRecords.reduce((sum, d) => sum + d.amount, 0);
  const damageSummary = damageRecords
    .map((d) => `- ${d.category}：NT$ ${d.amount.toLocaleString()}`)
    .join('\n');

  return {
    result: `已計算 ${damageRecords.length} 項金額：\n${damageSummary}\n\n請求總額：NT$ ${totalAmount.toLocaleString()}`,
    success: true,
  };
};
