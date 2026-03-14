/**
 * Dispute Analysis Stability Test
 *
 * Runs full analysis once via API to get CaseReaderOutput,
 * then runs Issue Analyzer N times in parallel to test consistency.
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/test-dispute-stability.ts [--runs 3] [--case-id XXX]
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

// ── Types ──

interface IssueAnalyzerResult {
  legalIssues: LegalIssue[];
  undisputedFacts: SimpleFact[];
  informationGaps: string[];
  durationMs: number;
}

// ── Run full analysis once via API to warm up Case Reader output ──

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

// ── Build CaseReaderOutput from DB (after API run cached it) ──

const buildCaseReaderOutputFromDB = (): CaseReaderOutput => {
  // Read file summaries to build fileNotes
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

    // Extract mentioned laws from summary
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

  // Read case data
  const caseRows = d1Query(
    `SELECT plaintiff, defendant FROM cases WHERE id = '${CASE_ID}'`,
  ) as Array<Record<string, string | null>>;
  const caseRow = caseRows[0] || { plaintiff: null, defendant: null };

  // Build a synthetic caseSummary from file summaries
  const caseSummary = fileNotes
    .map((n) => `[${n.filename}] ${n.key_facts.join('；')}`)
    .join('\n\n');

  return {
    caseSummary,
    parties: {
      plaintiff: caseRow.plaintiff || '',
      defendant: caseRow.defendant || '',
    },
    fileNotes,
  };
};

// ── Load case metadata ──

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

// ── Print single run ──

const printRun = (result: IssueAnalyzerResult, index: number): void => {
  console.log(`\n┌─ Run ${index + 1} (${(result.durationMs / 1000).toFixed(1)}s) ─────────`);
  console.log(`│ 不爭執事項: ${result.undisputedFacts.length} 項`);
  console.log(`│ 爭點: ${result.legalIssues.length} 個`);
  for (const [i, issue] of result.legalIssues.entries()) {
    console.log(
      `│   ${i + 1}. ${issue.title}  [證據:${issue.key_evidence.length} 法條:${issue.mentioned_laws.length}]`,
    );
  }
  console.log(`│ 資訊缺口: ${result.informationGaps.length} 項`);
  console.log(`└──────────────────────────`);
};

// ── Compare across runs ──

const printComparison = (results: IssueAnalyzerResult[]): void => {
  console.log('\n═══════════════════════════════════════');
  console.log('  穩定性比較');
  console.log('═══════════════════════════════════════\n');

  const pad = (s: string | number, w = 5) => String(s).padStart(w);
  console.log('        │ ' + results.map((_, i) => `Run ${i + 1}`).join(' │ '));
  console.log('────────┼' + results.map(() => '───────').join('─┼') + '─');
  console.log('爭點數  │ ' + results.map((r) => pad(r.legalIssues.length)).join(' │ '));
  console.log('不爭執  │ ' + results.map((r) => pad(r.undisputedFacts.length)).join(' │ '));
  console.log('資訊缺口│ ' + results.map((r) => pad(r.informationGaps.length)).join(' │ '));

  const totalEvidence = results.map((r) =>
    r.legalIssues.reduce((sum, d) => sum + d.key_evidence.length, 0),
  );
  console.log('總證據數│ ' + totalEvidence.map((n) => pad(n)).join(' │ '));

  const totalLaws = results.map((r) =>
    r.legalIssues.reduce((sum, d) => sum + d.mentioned_laws.length, 0),
  );
  console.log('總法條數│ ' + totalLaws.map((n) => pad(n)).join(' │ '));

  const durations = results.map((r) => (r.durationMs / 1000).toFixed(1) + 's');
  console.log('耗時    │ ' + durations.map((s) => pad(s)).join(' │ '));

  // Title comparison
  console.log('\n── 爭點標題比較 ──');
  const maxDisputes = Math.max(...results.map((r) => r.legalIssues.length));
  for (let i = 0; i < maxDisputes; i++) {
    console.log(`\n  爭點 ${i + 1}:`);
    for (let r = 0; r < results.length; r++) {
      const d = results[r].legalIssues[i];
      console.log(`    Run ${r + 1}: ${d ? d.title : '(無)'}`);
    }
  }

  // Stability score
  console.log('\n── 穩定性評分 ──');
  const disputeCounts = results.map((r) => r.legalIssues.length);
  const allSameCount = disputeCounts.every((c) => c === disputeCounts[0]);
  console.log(
    `  爭點數量一致: ${allSameCount ? '✓' : '✗'} (${[...new Set(disputeCounts)].join(', ')})`,
  );

  const undisputedCounts = results.map((r) => r.undisputedFacts.length);
  const undisputedRange = Math.max(...undisputedCounts) - Math.min(...undisputedCounts);
  console.log(
    `  不爭執事項數量差異: ${undisputedRange} (${[...new Set(undisputedCounts)].join(', ')})`,
  );

  if (results.length >= 2) {
    const titleSets = results.map((r) => new Set(r.legalIssues.map((d) => d.title)));
    const allTitles = new Set(results.flatMap((r) => r.legalIssues.map((d) => d.title)));
    const commonTitles = [...allTitles].filter((t) => titleSets.every((s) => s.has(t)));
    console.log(
      `  共同爭點標題: ${commonTitles.length}/${allTitles.size} (${((commonTitles.length / allTitles.size) * 100).toFixed(0)}%)`,
    );
    if (commonTitles.length < allTitles.size) {
      const unique = results.flatMap((r, i) =>
        r.legalIssues
          .filter((d) => !commonTitles.includes(d.title))
          .map((d) => `Run ${i + 1}: ${d.title}`),
      );
      if (unique.length > 0) {
        console.log('  非共同爭點:');
        unique.forEach((u) => console.log(`    - ${u}`));
      }
    }
  }

  console.log('');
};

// ── Main ──

const main = async (): Promise<void> => {
  console.log('═══ 爭點分析穩定性測試 ═══');
  console.log(`案件: ${CASE_ID}`);
  console.log(`次數: ${NUM_RUNS}`);

  // Phase 1: Run full analysis once via API (triggers Case Reader + Issue Analyzer)
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

  const promises = Array.from({ length: NUM_RUNS }, async (_, i): Promise<IssueAnalyzerResult> => {
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

  // Print results
  for (const [i, result] of results.entries()) {
    printRun(result, i);
  }

  printComparison(results);
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
