/**
 * Damages + Disputes Linking Test
 *
 * Tests whether damages analysis can correctly assign dispute_id
 * when given dispute context in the prompt.
 *
 * Approach (Option A — Sequential):
 *   1. Load existing disputes from DB (already analyzed)
 *   2. Load ready files + build file context (same as current damages analysis)
 *   3. Build an enhanced damages prompt that includes dispute list
 *   4. Call Gemini with constrained JSON schema (including dispute_id)
 *   5. Evaluate: did the AI correctly link damages to disputes?
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/test-damages-with-disputes.ts [--case-id XXX]
 *
 * Prerequisites:
 *   - Local D1 database with test case data (disputes already analyzed)
 *   - .dev.vars with CF_ACCOUNT_ID, CF_GATEWAY_ID, CF_AIG_TOKEN
 *   - No dev server needed (calls Gemini directly)
 */

import { callGeminiNative } from '../../src/server/agent/aiClient';
import { buildFileContext, loadReadyFiles } from '../../src/server/agent/toolHelpers';
import { getDB } from '../../src/server/db';
import {
  DAMAGES_WITH_DISPUTE_SCHEMA,
  buildDamagesPromptWithDisputes,
  type DisputeInfo,
} from '../../src/server/services/analysisService';
import { parseArgs, loadDevVars, d1Query } from './_helpers';

const { getArg } = parseArgs();
const CASE_ID = getArg('--case-id', 'z4keVNfyuKvL68Xg1qPl2');

const vars = loadDevVars();
const aiEnv = {
  CF_ACCOUNT_ID: vars.CF_ACCOUNT_ID || '',
  CF_GATEWAY_ID: vars.CF_GATEWAY_ID || '',
  CF_AIG_TOKEN: vars.CF_AIG_TOKEN || '',
};

// ── Types ──

interface DamageWithDispute {
  description: string;
  amount: number;
  basis: string;
  dispute_id: string | null;
}

// ── Load disputes from DB ──

const loadDisputes = (): DisputeInfo[] => {
  const rows = d1Query(
    `SELECT id, number, title FROM disputes WHERE case_id = '${CASE_ID}' ORDER BY number`,
  ) as Array<{ id: string; number: number; title: string }>;
  return rows;
};

// ── Load ready files via D1 (bypass Workers runtime) ──

const loadReadyFilesFromD1 = (): Array<{
  id: string;
  filename: string;
  category: string | null;
  doc_date: string | null;
  summary: string | null;
}> => {
  const rows = d1Query(
    `SELECT id, filename, category, doc_date, summary FROM files WHERE case_id = '${CASE_ID}' AND summary IS NOT NULL`,
  ) as Array<{
    id: string;
    filename: string;
    category: string | null;
    doc_date: string | null;
    summary: string | null;
  }>;
  return rows;
};

// ── Main ──

const main = async (): Promise<void> => {
  console.log('═══ 金額分析 + 爭點分配測試 (Option A: Sequential) ═══');
  console.log(`案件: ${CASE_ID}\n`);

  // 1. Load disputes
  const disputes = loadDisputes();
  if (disputes.length === 0) {
    console.error('找不到爭點資料，請先執行爭點分析');
    process.exit(1);
  }
  console.log(`── 爭點 (${disputes.length} 個) ──`);
  for (const d of disputes) {
    console.log(`  ${d.number}. [${d.id}] ${d.title}`);
  }

  // 2. Load ready files
  const readyFiles = loadReadyFilesFromD1();
  if (readyFiles.length === 0) {
    console.error('找不到已處理的檔案');
    process.exit(1);
  }
  console.log(`\n── 檔案 (${readyFiles.length} 份) ──`);
  for (const f of readyFiles) {
    console.log(`  ${f.filename} (${f.category})`);
  }

  // 3. Build prompt
  const fileContext = buildFileContext(readyFiles, { enriched: true });
  const prompt = buildDamagesPromptWithDisputes(fileContext, disputes);

  console.log(`\n── 呼叫 Gemini ──`);
  console.log(`  Prompt 長度: ${prompt.length} chars`);

  // 4. Call Gemini
  const start = Date.now();
  const result = await callGeminiNative(aiEnv, '你是專業的台灣法律分析助手。', prompt, {
    maxTokens: 8192,
    responseSchema: DAMAGES_WITH_DISPUTE_SCHEMA,
    temperature: 0,
    thinkingBudget: 0,
  });
  const durationMs = Date.now() - start;

  // 5. Parse result
  let items: DamageWithDispute[];
  try {
    items = JSON.parse(result.content) as DamageWithDispute[];
  } catch {
    console.error('JSON 解析失敗:', result.content.slice(0, 500));
    process.exit(1);
  }

  console.log(`  完成，耗時 ${(durationMs / 1000).toFixed(1)}s`);
  console.log(
    `  Token 使用: input=${result.usage.input_tokens}, output=${result.usage.output_tokens}`,
  );

  // 6. Display results
  console.log(`\n═══ 結果 (${items.length} 筆金額) ═══\n`);

  const disputeMap = new Map(disputes.map((d) => [d.id, d]));
  const totalAmount = items.reduce((sum, d) => sum + d.amount, 0);

  // Group by dispute
  const byDispute = new Map<string | null, DamageWithDispute[]>();
  for (const item of items) {
    const key = item.dispute_id;
    const list = byDispute.get(key) ?? [];
    list.push(item);
    byDispute.set(key, list);
  }

  for (const [disputeId, damageItems] of byDispute.entries()) {
    const subtotal = damageItems.reduce((sum, d) => sum + d.amount, 0);
    if (disputeId) {
      const dispute = disputeMap.get(disputeId);
      console.log(`┌─ 爭點 ${dispute?.number ?? '?'}: ${dispute?.title ?? disputeId}`);
    } else {
      console.log(`┌─ 未分類`);
    }
    for (const d of damageItems) {
      console.log(
        `│  ${(d.description || '').padEnd(15)} NT$ ${d.amount.toLocaleString().padStart(10)}`,
      );
    }
    console.log(`│  小計: NT$ ${subtotal.toLocaleString()}`);
    console.log(`└──────────────────────────`);
  }

  console.log(`\n請求總額: NT$ ${totalAmount.toLocaleString()}`);

  // 7. Quality checks
  console.log('\n═══ 品質檢查 ═══\n');

  const assigned = items.filter((d) => d.dispute_id !== null);
  const unassigned = items.filter((d) => d.dispute_id === null);
  const validIds = items.filter((d) => d.dispute_id === null || disputeMap.has(d.dispute_id));
  const invalidIds = items.filter((d) => d.dispute_id !== null && !disputeMap.has(d.dispute_id));

  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  };

  check(items.length >= 3, `金額項目數量 >= 3 (actual: ${items.length})`);
  check(
    assigned.length > 0,
    `至少有 1 筆金額分配到爭點 (actual: ${assigned.length}/${items.length})`,
  );
  check(invalidIds.length === 0, `無無效 dispute_id (invalid: ${invalidIds.length})`);
  check(totalAmount > 0, `總金額 > 0 (actual: NT$ ${totalAmount.toLocaleString()})`);

  // Check that each dispute with obvious amount reference got at least one damage
  const disputesWithDamages = new Set(items.map((d) => d.dispute_id).filter(Boolean));
  check(
    disputesWithDamages.size >= 2,
    `至少 2 個爭點有關聯金額 (actual: ${disputesWithDamages.size}/${disputes.length})`,
  );

  // Expected amounts from this case (known ground truth)
  if (CASE_ID === 'z4keVNfyuKvL68Xg1qPl2') {
    console.log('\n── 已知案件比對 ──');
    const expectedItems = [
      { desc: '醫療', min: 40000, max: 45000 },
      { desc: '交通', min: 10000, max: 15000 },
      { desc: '不能工作', min: 150000, max: 160000 },
      { desc: '財物', min: 10000, max: 15000 },
      { desc: '精神慰撫金', min: 190000, max: 210000 },
    ];

    for (const expected of expectedItems) {
      const match = items.find(
        (d) =>
          d.description.includes(expected.desc) &&
          d.amount >= expected.min &&
          d.amount <= expected.max,
      );
      check(
        !!match,
        `${expected.desc}: 金額在 ${expected.min.toLocaleString()}-${expected.max.toLocaleString()} 範圍 (actual: ${match ? `NT$ ${match.amount.toLocaleString()}, dispute_id=${match.dispute_id ? disputeMap.get(match.dispute_id)?.title?.slice(0, 20) : 'null'}` : '未找到'})`,
      );
    }
  }

  if (invalidIds.length > 0) {
    console.log('\n⚠️ 無效的 dispute_id:');
    for (const d of invalidIds) {
      console.log(`  ${d.description}: dispute_id="${d.dispute_id}" (不在爭點列表中)`);
    }
  }

  console.log('');
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
