/**
 * Verify the new analysis implementation (CE-t0) against existing DB data.
 * Tests: damages + disputes + timeline using the exact same logic as production.
 *
 * Usage: npx tsx scripts/analysis-verify.ts
 */

import { stripFFFD } from '../src/server/lib/sanitize';
import { DISPUTES_SCHEMA } from '../src/server/agent/tools/analyzeDisputes';
import { DAMAGES_SCHEMA } from '../src/server/agent/tools/calculateDamages';
import { TIMELINE_SCHEMA } from '../src/server/agent/tools/generateTimeline';

// ── Config ──

const CASE_ID = 'z4keVNfyuKvL68Xg1qPl2';

const requireEnv = (name: string): string => {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
};

const CF_ACCOUNT_ID = requireEnv('CF_ACCOUNT_ID');
const CF_GATEWAY_ID = requireEnv('CF_GATEWAY_ID');
const CF_AIG_TOKEN = requireEnv('CF_AIG_TOKEN');

const GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}`;
const NATIVE_URL = `${GATEWAY_BASE}/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent`;
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'cf-aig-authorization': `Bearer ${CF_AIG_TOKEN}`,
};

// ── Types ──

interface DisputeItem {
  number: number;
  title: string;
  our_position: string;
  their_position: string;
  evidence: string[];
  law_refs: string[];
}

interface DamageItem {
  category: string;
  description: string;
  amount: number;
  basis: string;
}

interface TimelineItem {
  date: string;
  title: string;
  description: string;
  is_critical: boolean;
}

interface FileRow {
  filename: string;
  category: string | null;
  doc_date: string | null;
  summary: string | null;
}

// ── DB helpers ──

const execD1 = async (sql: string): Promise<Record<string, unknown>[]> => {
  const { execSync } = await import('child_process');
  const raw = execSync(
    `npx wrangler d1 execute lexdraft-db --local --command "${sql}" --json 2>/dev/null`,
    { encoding: 'utf-8' },
  );
  return JSON.parse(raw)[0].results;
};

// ── Prompts (same as production tools) ──

const DISPUTES_PROMPT = (ctx: string) => `請根據以下案件文件摘要，分析雙方的爭點。

${ctx}

請回傳爭點列表。
- number：爭點編號（從 1 開始）
- title：爭點標題
- our_position：我方立場
- their_position：對方立場
- evidence：相關證據列表
- law_refs：相關法條列表（如「民法第XXX條」）

重要：不要使用 emoji 或特殊符號（如 ✅❌🔷📄⚖️💰🔨 等），只用純中文文字和標點符號。`;

const DAMAGES_PROMPT = (ctx: string) => `請根據以下案件文件摘要，計算各項請求金額明細。

${ctx}

category 只能是以下兩種之一：
- "財產上損害"：醫療費用、交通費用、工作損失、財物損害、貨款、利息、違約金等
- "非財產上損害"：精神慰撫金等
description 為該項目的具體名稱。
amount 為整數，以新台幣元計。如果文件中的「主張」欄位有列出明確金額，直接使用該精確金額。
重要：
- 不要使用 emoji 或特殊符號
- 不要包含「總計」或「合計」項目，只列出個別金額項目`;

const TIMELINE_PROMPT = (ctx: string) => `請根據以下案件文件摘要，產生時間軸事件列表。

${ctx}

規則：
- date 格式為 YYYY-MM-DD，若只知年月則為 YYYY-MM-01，若只知年則為 YYYY-01-01
- 只使用文件中明確提及的日期，不要推測或虛構日期
- is_critical 標記法律程序關鍵節點（起訴、判決、鑑定、調解等），一般就醫或休養不算 critical
- 按日期從早到晚排序
- 不要使用 emoji 或特殊符號`;

// ── Enriched file context (same as production buildFileContext enriched) ──

const buildEnrichedContext = (
  files: FileRow[],
  opts: { includeDocDate?: boolean } = {},
): string => {
  return files
    .map((f) => {
      const lines: string[] = [`【${f.filename}】(${f.category})`];
      if (opts.includeDocDate) lines.push(`日期：${f.doc_date || '不明'}`);

      if (f.summary) {
        try {
          const parsed = JSON.parse(f.summary);
          if (typeof parsed === 'object' && parsed !== null) {
            lines.push(`摘要：${parsed.summary || '無'}`);
            const keyClaims = parsed.key_claims as string[] | undefined;
            const keyAmounts = parsed.key_amounts as number[] | undefined;
            const keyDates = parsed.key_dates as string[] | undefined;
            if (keyClaims?.length) lines.push(`主張：${keyClaims.join('；')}`);
            if (keyAmounts?.length)
              lines.push(
                `金額：${keyAmounts.map((a: number) => `NT$${a.toLocaleString()}`).join('、')}`,
              );
            if (keyDates?.length) lines.push(`相關日期：${keyDates.join('；')}`);
          } else {
            lines.push(`摘要：${String(parsed)}`);
          }
        } catch {
          lines.push(`摘要：${f.summary}`);
        }
      } else {
        lines.push(`摘要：無`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
};

// ── AI Caller (same as production: callGeminiNative + thinkingBudget:0 + temperature:0) ──

const callGeminiNative = async (
  prompt: string,
  schema: Record<string, unknown>,
): Promise<{ content: string; ms: number }> => {
  const start = Date.now();
  const res = await fetch(NATIVE_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: '你是專業的台灣法律分析助手。' }] },
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Native ${res.status}: ${err.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = stripFFFD(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
  return { content, ms: Date.now() - start };
};

// ── Main ──

const main = async () => {
  console.log('=== Analysis Verification (CE-t0 implementation) ===');
  console.log(`Case: ${CASE_ID}\n`);

  // 1. Load files + existing data from local D1
  const [files, dbDamages, dbDisputes, dbTimelineRow] = await Promise.all([
    execD1(
      `SELECT filename, category, doc_date, summary FROM files WHERE case_id = '${CASE_ID}' AND summary IS NOT NULL`,
    ) as Promise<FileRow[]>,
    execD1(
      `SELECT category, description, amount FROM damages WHERE case_id = '${CASE_ID}'`,
    ) as Promise<Array<{ category: string; description: string; amount: number }>>,
    execD1(
      `SELECT title, our_position, their_position, evidence, law_refs FROM disputes WHERE case_id = '${CASE_ID}'`,
    ),
    execD1(`SELECT timeline FROM cases WHERE id = '${CASE_ID}'`),
  ]);

  const dbTimeline: TimelineItem[] = JSON.parse((dbTimelineRow[0]?.timeline as string) || '[]');
  const dbDamagesTotal = dbDamages.reduce((s, d) => s + d.amount, 0);

  console.log(`Files: ${files.length}`);
  console.log(`DB damages: ${dbDamages.length} items, NT$${dbDamagesTotal.toLocaleString()}`);
  console.log(`DB disputes: ${dbDisputes.length}`);
  console.log(`DB timeline: ${dbTimeline.length} events\n`);

  // 2. Build enriched context
  const baseCtx = buildEnrichedContext(files);
  const timelineCtx = buildEnrichedContext(files, { includeDocDate: true });

  // 3. Call AI (all 3 in parallel)
  console.log('Calling Gemini Native (3 analyses in parallel)...\n');
  const [damagesRes, disputesRes, timelineRes] = await Promise.all([
    callGeminiNative(DAMAGES_PROMPT(baseCtx), DAMAGES_SCHEMA),
    callGeminiNative(DISPUTES_PROMPT(baseCtx), DISPUTES_SCHEMA),
    callGeminiNative(TIMELINE_PROMPT(timelineCtx), TIMELINE_SCHEMA),
  ]);

  // 4. Parse
  const newDamages: DamageItem[] = JSON.parse(damagesRes.content);
  const newDisputes: DisputeItem[] = JSON.parse(disputesRes.content);
  const newTimeline: TimelineItem[] = JSON.parse(timelineRes.content);
  newTimeline.sort((a, b) => a.date.localeCompare(b.date));

  // ── 5. Compare Damages ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  DAMAGES (${damagesRes.ms}ms)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const newTotal = newDamages.reduce((s, d) => s + d.amount, 0);
  console.log(
    `  DB: ${dbDamages.length} items, NT$${dbDamagesTotal.toLocaleString()} | New: ${newDamages.length} items, NT$${newTotal.toLocaleString()}\n`,
  );

  // Side by side comparison
  console.log(`  ${'DB'.padEnd(45)} | New`);
  console.log('  ' + '-'.repeat(95));
  const maxDmg = Math.max(dbDamages.length, newDamages.length);
  for (let i = 0; i < maxDmg; i++) {
    const db = dbDamages[i];
    const nw = newDamages[i];
    const dbStr = db
      ? `${db.description} NT$${db.amount.toLocaleString()}`.padEnd(45)
      : ''.padEnd(45);
    const nwStr = nw ? `${nw.description} NT$${nw.amount.toLocaleString()}` : '';
    console.log(`  ${dbStr} | ${nwStr}`);
  }

  // Check exact matches
  let exactMatches = 0;
  for (const db of dbDamages) {
    const match = newDamages.find(
      (n) => n.description.includes(db.description) || db.description.includes(n.description),
    );
    if (match && match.amount === db.amount) exactMatches++;
  }
  console.log(
    `\n  Total match: ${newTotal === dbDamagesTotal ? 'YES' : `NO (diff: NT$${Math.abs(newTotal - dbDamagesTotal).toLocaleString()})`}`,
  );
  console.log(`  Exact item matches: ${exactMatches}/${dbDamages.length}`);

  // ── 6. Compare Disputes ──
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  DISPUTES (${disputesRes.ms}ms)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  DB: ${dbDisputes.length} 個爭點 | New: ${newDisputes.length} 個爭點\n`);

  // Show new disputes
  for (const d of newDisputes) {
    console.log(`  ${d.number}. ${d.title}`);
    console.log(
      `     我方: ${d.our_position.slice(0, 80)}${d.our_position.length > 80 ? '...' : ''}`,
    );
    console.log(
      `     對方: ${d.their_position.slice(0, 80)}${d.their_position.length > 80 ? '...' : ''}`,
    );
    console.log(`     證據: ${d.evidence.join('、') || '無'}`);
    console.log(`     法條: ${d.law_refs.join('、') || '無'}`);
    console.log();
  }

  // Compare titles
  const dbTitles = dbDisputes.map((d) => d.title as string);
  const newTitles = newDisputes.map((d) => d.title);
  console.log('  Title comparison:');
  console.log('    DB titles:');
  dbTitles.forEach((t) => console.log(`      - ${t}`));
  console.log('    New titles:');
  newTitles.forEach((t) => console.log(`      - ${t}`));

  // Check coverage
  const dbTitleKeywords = dbTitles.map((t) => {
    if (t.includes('全部損害賠償')) return '肇事責任';
    if (t.includes('醫療')) return '醫療';
    if (t.includes('交通')) return '交通';
    if (t.includes('工作')) return '工作損失';
    if (t.includes('財物') || t.includes('機車')) return '財物';
    if (t.includes('精神')) return '精神慰撫金';
    return t;
  });
  const newTitleKeywords = newTitles.map((t) => {
    if (t.includes('責任') || t.includes('肇事')) return '肇事責任';
    if (t.includes('醫療')) return '醫療';
    if (t.includes('交通')) return '交通';
    if (t.includes('工作') || t.includes('薪資')) return '工作損失';
    if (t.includes('財物') || t.includes('機車')) return '財物';
    if (t.includes('精神')) return '精神慰撫金';
    return t;
  });

  const covered = dbTitleKeywords.filter((k) => newTitleKeywords.includes(k));
  const missing = dbTitleKeywords.filter((k) => !newTitleKeywords.includes(k));
  const extra = newTitleKeywords.filter((k) => !dbTitleKeywords.includes(k));

  console.log(`\n  Coverage: ${covered.length}/${dbTitleKeywords.length} DB topics covered`);
  if (missing.length) console.log(`  Missing: ${missing.join(', ')}`);
  if (extra.length) console.log(`  Extra: ${extra.join(', ')}`);

  // ── 6. Compare Timeline ──
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  TIMELINE (${timelineRes.ms}ms)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  DB: ${dbTimeline.length} events | New: ${newTimeline.length} events\n`);

  // Side by side
  const maxLen = Math.max(dbTimeline.length, newTimeline.length);
  console.log(`  ${'DB'.padEnd(45)} | New`);
  console.log('  ' + '-'.repeat(95));
  for (let i = 0; i < maxLen; i++) {
    const db = dbTimeline[i];
    const nw = newTimeline[i];
    const dbStr = db ? `${db.date} ${db.title}`.slice(0, 43).padEnd(45) : ''.padEnd(45);
    const nwStr = nw ? `${nw.is_critical ? '*' : ' '} ${nw.date} ${nw.title}`.slice(0, 48) : '';
    console.log(`  ${dbStr} | ${nwStr}`);
  }

  // Date coverage
  const dbDates = new Set(dbTimeline.map((t) => t.date));
  const newDates = new Set(newTimeline.map((t) => t.date));
  const matchedDates = [...dbDates].filter((d) => newDates.has(d));
  const missingDates = [...dbDates].filter((d) => !newDates.has(d));
  const extraDates = [...newDates].filter((d) => !dbDates.has(d));

  console.log(`\n  Date coverage: ${matchedDates.length}/${dbDates.size} DB dates matched`);
  if (missingDates.length) console.log(`  Missing dates: ${missingDates.join(', ')}`);
  if (extraDates.length) console.log(`  Extra dates: ${extraDates.join(', ')}`);

  // ── 7. Summary ──
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  VERDICT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(
    `  Disputes: ${newDisputes.length} items, ${covered.length}/${dbTitleKeywords.length} topics covered, ${disputesRes.ms}ms`,
  );
  console.log(
    `  Timeline: ${newTimeline.length} events, ${matchedDates.length}/${dbDates.size} dates matched, ${timelineRes.ms}ms`,
  );
  console.log(`  Parse: both OK (schema guaranteed)`);
};

main().catch(console.error);
