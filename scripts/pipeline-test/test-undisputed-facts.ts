/**
 * Undisputed Facts Quality Test
 *
 * Runs Issue Analyzer N times and evaluates the quality of undisputed facts.
 * Checks for common anti-patterns:
 *   - Background descriptions (天候、路面、速限)
 *   - Procedural items (調解不成立、訴訟經過)
 *   - Settlement amounts (調解金額、讓步)
 *   - Overly granular items that should be merged
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/test-undisputed-facts.ts [--runs 3] [--case-id XXX]
 *
 * Prerequisites:
 *   - Dev server running on localhost:5173 (`npm run dev`)
 *   - Local D1 database with test case data
 */

import { runIssueAnalyzer } from '../../src/server/agent/orchestratorAgent';
import type { CaseReaderOutput } from '../../src/server/agent/orchestratorAgent';
import type { LegalIssue, SimpleFact } from '../../src/server/agent/pipeline/types';
import type { CaseMetadata } from '../../src/server/agent/contextStore';
import { parseArgs, loadDevVars, d1Query } from './_helpers';

const { getArg } = parseArgs();

const NUM_RUNS = parseInt(getArg('--runs', '3'), 10);
const CASE_ID = getArg('--case-id', 'z4keVNfyuKvL68Xg1qPl2');
const BASE_URL = getArg('--url', 'http://localhost:5173');

const vars = loadDevVars();
const AUTH_TOKEN = vars.AUTH_TOKEN || 'dev-token-change-me';
const aiEnv = {
  CF_ACCOUNT_ID: vars.CF_ACCOUNT_ID || '',
  CF_GATEWAY_ID: vars.CF_GATEWAY_ID || '',
  CF_AIG_TOKEN: vars.CF_AIG_TOKEN || '',
};

// ── Anti-pattern keywords ──

const BACKGROUND_KEYWORDS = [
  '天候',
  '晴朗',
  '路面乾燥',
  '柏油路面',
  '道路型態',
  '速限',
  '氣溫',
  '能見度',
  '路面濕滑',
];

const PROCEDURAL_KEYWORDS = [
  '調解不成立',
  '調解委員會',
  '訴訟經過',
  '送達',
  '起訴',
  '鄉鎮市調解條例',
];

const SETTLEMENT_KEYWORDS = [
  '願給付',
  '願負擔',
  '最高僅能',
  '最低可接受',
  '調解時',
  '出價',
  '讓步',
  '底價',
];

// ── Types ──

interface RunResult {
  legalIssues: LegalIssue[];
  undisputedFacts: SimpleFact[];
  informationGaps: string[];
  durationMs: number;
}

interface FactCheck {
  description: string;
  issues: string[];
}

// ── Quality checker ──

// Strip file references in any bracket style: [] () （） 【】 before keyword matching
const stripFileRefs = (text: string): string =>
  text
    .replace(/[\[(\uFF08\u3010][^\])\uFF09\u3011]*\.\w{2,4}[\])\uFF09\u3011]/g, '')
    .replace(
      /[\[(\uFF08\u3010][^\])\uFF09\u3011]*案件基本資訊[^\])\uFF09\u3011]*[\])\uFF09\u3011]/g,
      '',
    );

const checkFact = (fact: SimpleFact): FactCheck => {
  const issues: string[] = [];
  const d = stripFileRefs(fact.description);

  for (const kw of BACKGROUND_KEYWORDS) {
    if (d.includes(kw)) {
      issues.push(`背景描述: 含「${kw}」`);
      break;
    }
  }

  for (const kw of PROCEDURAL_KEYWORDS) {
    if (d.includes(kw)) {
      issues.push(`程序性事項: 含「${kw}」`);
      break;
    }
  }

  for (const kw of SETTLEMENT_KEYWORDS) {
    if (d.includes(kw)) {
      issues.push(`調解讓步: 含「${kw}」`);
      break;
    }
  }

  // Check if too short (likely not a complete legal proposition)
  if (d.length < 15) {
    issues.push(`過短 (${d.length} 字)`);
  }

  return { description: d, issues };
};

// ── Build CaseReaderOutput from DB ──

const buildCaseReaderOutputFromDB = (): CaseReaderOutput => {
  const fileRows = d1Query(
    `SELECT id, filename, category, summary, full_text FROM files WHERE case_id = '${CASE_ID}' AND status = 'ready'`,
  ) as Array<Record<string, string | null>>;

  const fileNotes = fileRows.map((f) => {
    const summary = f.summary || '';
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(summary);
    } catch {
      /* not JSON */
    }

    const mentionedLaws: string[] = [];
    const fullText = f.full_text || '';
    const lawMatches = fullText.match(
      /(?:民法|刑法|道路交通安全規則|道路交通管理處罰條例|勞動基準法)[^。，\n]{0,50}/g,
    );
    if (lawMatches) mentionedLaws.push(...new Set(lawMatches));

    return {
      filename: f.filename || '',
      key_facts: (parsed.key_claims as string[]) || [],
      mentioned_laws: mentionedLaws,
      claims: (parsed.key_claims as string[]) || [],
      key_amounts: ((parsed.key_amounts as number[]) || []).map(String),
    };
  });

  const caseRows = d1Query(
    `SELECT plaintiff, defendant FROM cases WHERE id = '${CASE_ID}'`,
  ) as Array<Record<string, string | null>>;
  const caseRow = caseRows[0] || { plaintiff: null, defendant: null };

  const caseSummary = fileNotes
    .map((n) => `[${n.filename}] ${n.key_facts.join('；')}`)
    .join('\n\n');

  return {
    caseSummary,
    parties: {
      plaintiff: caseRow.plaintiff || '',
      defendant: caseRow.defendant || '',
    },
    timelineSummary: '',
    fileNotes,
  };
};

const loadCaseMetadata = (): CaseMetadata => {
  const rows = d1Query(
    `SELECT case_number, court, division, client_role, case_instructions FROM cases WHERE id = '${CASE_ID}'`,
  ) as Array<Record<string, string | null>>;

  const row = rows[0];
  if (!row) throw new Error(`Case ${CASE_ID} not found`);

  return {
    caseNumber: row.case_number || '',
    court: row.court || '',
    division: row.division || '',
    clientRole: (row.client_role as 'plaintiff' | 'defendant') || '',
    caseInstructions: row.case_instructions || '',
  };
};

// ── Run API once to warm up Case Reader ──

const runFullAnalysisOnce = async (): Promise<void> => {
  const res = await fetch(`${BASE_URL}/api/cases/${CASE_ID}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({ type: 'disputes' }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
};

// ── Print helpers ──

const printRunDetail = (result: RunResult, index: number): void => {
  console.log(`\n┌─ Run ${index + 1} (${(result.durationMs / 1000).toFixed(1)}s) ─────────`);
  console.log(`│ 爭點: ${result.legalIssues.length} 個`);
  for (const [i, issue] of result.legalIssues.entries()) {
    console.log(`│   ${i + 1}. ${issue.title}`);
  }
  console.log(`│`);
  console.log(`│ 不爭執事項: ${result.undisputedFacts.length} 項`);

  for (const [i, fact] of result.undisputedFacts.entries()) {
    const check = checkFact(fact);
    const tag = check.issues.length > 0 ? ` ⚠ ${check.issues.join(', ')}` : ' ✓';
    const desc =
      fact.description.length > 80 ? fact.description.slice(0, 80) + '…' : fact.description;
    console.log(`│   ${i + 1}. ${desc}${tag}`);
  }
  console.log(`└──────────────────────────`);
};

const printSummary = (results: RunResult[]): void => {
  console.log('\n═══════════════════════════════════════');
  console.log('  不爭執事項品質報告');
  console.log('═══════════════════════════════════════\n');

  // ── Counts ──
  const pad = (s: string | number, w = 5) => String(s).padStart(w);
  console.log('        │ ' + results.map((_, i) => `Run ${i + 1}`).join(' │ '));
  console.log('────────┼' + results.map(() => '───────').join('─┼') + '─');
  console.log('爭點數  │ ' + results.map((r) => pad(r.legalIssues.length)).join(' │ '));
  console.log('不爭執  │ ' + results.map((r) => pad(r.undisputedFacts.length)).join(' │ '));

  // ── Anti-pattern detection across runs ──
  console.log('\n── 反模式檢測 ──');

  let totalFlagged = 0;
  let totalFacts = 0;

  for (const [ri, result] of results.entries()) {
    const checks = result.undisputedFacts.map(checkFact);
    const flagged = checks.filter((c) => c.issues.length > 0);
    totalFlagged += flagged.length;
    totalFacts += checks.length;

    if (flagged.length > 0) {
      console.log(`\n  Run ${ri + 1}: ${flagged.length}/${checks.length} 項有問題`);
      for (const fc of flagged) {
        const desc =
          fc.description.length > 60 ? fc.description.slice(0, 60) + '…' : fc.description;
        console.log(`    ⚠ ${fc.issues.join(', ')} → 「${desc}」`);
      }
    } else {
      console.log(`\n  Run ${ri + 1}: 全部通過 ✓ (${checks.length} 項)`);
    }
  }

  // ── Aggregate stats ──
  console.log('\n── 統計 ──');
  const counts = results.map((r) => r.undisputedFacts.length);
  const avg = (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const flagRate = totalFacts > 0 ? ((totalFlagged / totalFacts) * 100).toFixed(0) : '0';

  console.log(`  平均數量: ${avg} (${min}~${max})`);
  console.log(`  反模式率: ${flagRate}% (${totalFlagged}/${totalFacts})`);

  // ── Dispute stability ──
  const disputeCounts = results.map((r) => r.legalIssues.length);
  const allSameCount = disputeCounts.every((c) => c === disputeCounts[0]);
  console.log(
    `  爭點數量一致: ${allSameCount ? '✓' : '✗'} (${[...new Set(disputeCounts)].join(', ')})`,
  );

  // ── Title stability ──
  if (results.length >= 2) {
    const titleSets = results.map((r) => new Set(r.legalIssues.map((d) => d.title)));
    const allTitles = new Set(results.flatMap((r) => r.legalIssues.map((d) => d.title)));
    const commonTitles = [...allTitles].filter((t) => titleSets.every((s) => s.has(t)));
    console.log(
      `  共同爭點標題: ${commonTitles.length}/${allTitles.size} (${((commonTitles.length / allTitles.size) * 100).toFixed(0)}%)`,
    );
  }

  // ── Pass/fail ──
  console.log('\n── 結論 ──');
  const passCount = results.filter((r) => {
    const checks = r.undisputedFacts.map(checkFact);
    return checks.every((c) => c.issues.length === 0);
  }).length;

  if (passCount === results.length) {
    console.log(`  ✓ 全部 ${results.length} 次執行通過反模式檢測`);
  } else {
    console.log(`  ✗ ${passCount}/${results.length} 次通過反模式檢測`);
  }

  const targetRange = max - min <= 2;
  if (targetRange) {
    console.log(`  ✓ 不爭執事項數量穩定 (差異 ≤ 2)`);
  } else {
    console.log(`  ✗ 不爭執事項數量波動過大 (${min}~${max})`);
  }

  console.log('');
};

// ── Main ──

const main = async (): Promise<void> => {
  console.log('═══ 不爭執事項品質測試 ═══');
  console.log(`案件: ${CASE_ID}`);
  console.log(`次數: ${NUM_RUNS}`);

  // Phase 1: Run full analysis once via API (warm up Case Reader)
  console.log('\n── Phase 1: API 觸發完整分析（取得 Case Reader 結果）──');
  const apiStart = Date.now();
  await runFullAnalysisOnce();
  console.log(`  完成，耗時 ${((Date.now() - apiStart) / 1000).toFixed(1)}s`);

  // Phase 2: Build CaseReaderOutput from DB + load metadata
  const caseReaderOutput = buildCaseReaderOutputFromDB();
  const caseMetadata = loadCaseMetadata();
  console.log(`  Case Reader 結果: ${caseReaderOutput.fileNotes.length} 份檔案筆記`);

  // Phase 3: Run Issue Analyzer N times in parallel
  console.log(`\n── Phase 2: Issue Analyzer（${NUM_RUNS} 次平行執行）──`);
  const startAll = Date.now();

  const promises = Array.from({ length: NUM_RUNS }, async (_, i): Promise<RunResult> => {
    const start = Date.now();
    const result = await runIssueAnalyzer(
      aiEnv,
      caseReaderOutput,
      '準備書狀',
      new AbortController().signal,
      caseMetadata,
    );
    const durationMs = Date.now() - start;
    console.log(`  Run ${i + 1} 完成 (${(durationMs / 1000).toFixed(1)}s)`);
    return { ...result, durationMs };
  });

  const results = await Promise.all(promises);
  const totalDuration = Date.now() - startAll;
  console.log(`  全部完成，總耗時 ${(totalDuration / 1000).toFixed(1)}s`);

  // Print detailed results
  for (const [i, result] of results.entries()) {
    printRunDetail(result, i);
  }

  // Print quality summary
  printSummary(results);
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
