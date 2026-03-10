/**
 * Layer 2: Pipeline Integration Benchmark
 *
 * Triggers the brief writing pipeline N times on a test case,
 * then queries D1 for citation statistics and outputs a comparison table.
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/pipeline-benchmark.ts [--runs 3] [--case-id XXX] [--save-snapshots]
 *
 * Prerequisites:
 *   - Dev server running on localhost:5173 (`npm run dev`)
 *   - Local D1 database with test case data
 *
 * Env: AUTH_TOKEN loaded from dist/lexdraft/.dev.vars
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { buildQualityReport } from '../../src/server/agent/pipeline/qualityReport';
import type { Paragraph } from '../../src/client/stores/useBriefStore';
import { createSnapshotWriter } from './snapshot-writer';
import { parseArgs, loadDevVars, d1Query as d1QueryBase } from './_helpers';

// ══════════════════════════════════════════════════════════
//  Config
// ══════════════════════════════════════════════════════════

const { getArg, hasFlag } = parseArgs();

const NUM_RUNS = parseInt(getArg('--runs', '3'), 10);
const CASE_ID = getArg('--case-id', 'z4keVNfyuKvL68Xg1qPl2');
const BASE_URL = getArg('--url', 'http://localhost:5173');
const CHAT_MESSAGE = getArg('--message', '請幫我撰寫準備書狀');
const SAVE_SNAPSHOTS = hasFlag('--save-snapshots');

const AUTH_TOKEN = loadDevVars().AUTH_TOKEN || 'dev-token-change-me';

// ══════════════════════════════════════════════════════════
//  D1 Helpers
// ══════════════════════════════════════════════════════════

const d1Query = (sql: string) =>
  d1QueryBase(sql, { maxBuffer: 1024 * 1024 * 10 }) as Array<Record<string, unknown>>;

// ══════════════════════════════════════════════════════════
//  SSE Pipeline Runner
// ══════════════════════════════════════════════════════════

interface RunResult {
  briefId: string;
  elapsed: number;
  sseEvents: unknown[];
  snapshotDir?: string;
}

const runPipeline = async (runIndex: number): Promise<RunResult | null> => {
  // Set up snapshot writer if enabled
  let snapshotWriter: ((stepName: string, data: unknown) => void) | null = null;
  let snapshotDir: string | undefined;
  if (SAVE_SNAPSHOTS) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    snapshotDir = resolve(`snapshots/${CASE_ID}-${ts}-run${runIndex + 1}`);
    snapshotWriter = createSnapshotWriter(snapshotDir);
    console.log(`  Snapshots → ${snapshotDir}`);
  }
  const url = `${BASE_URL}/api/cases/${CASE_ID}/chat`;
  console.log(`\n── Run ${runIndex + 1}/${NUM_RUNS} ──`);
  console.log(`POST ${url}`);

  const startTime = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      message: CHAT_MESSAGE,
      ...(SAVE_SNAPSHOTS && { enableSnapshots: true }),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText.slice(0, 300)}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let briefId: string | null = null;
  const sseEvents: unknown[] = [];
  let lastProgressLine = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr) as Record<string, unknown>;
        // Skip storing large snapshot_data events to avoid memory bloat
        if (event.type !== 'snapshot_data') sseEvents.push(event);

        if (event.type === 'brief_update' && event.action === 'add_paragraph' && event.brief_id) {
          briefId = event.brief_id as string;
        }

        if (event.type === 'pipeline_progress') {
          const steps = (event.steps as { status: string; label: string }[]) || [];
          const currentStep = steps.find((s) => s.status === 'running');
          const progressLine = currentStep
            ? `  [${steps.filter((s) => s.status === 'done').length}/${steps.length}] ${currentStep.label}...`
            : `  [${steps.filter((s) => s.status === 'done').length}/${steps.length}] waiting...`;
          if (progressLine !== lastProgressLine) {
            process.stdout.write('\r' + progressLine.padEnd(80));
            lastProgressLine = progressLine;
          }
        }

        if (event.type === 'brief_update' && event.action === 'add_paragraph') {
          const data = event.data as { section?: string; subsection?: string } | undefined;
          const sec = data?.section || '?';
          const sub = data?.subsection ? ' > ' + data.subsection : '';
          process.stdout.write(`\r  ✓ 段落完成: ${sec}${sub}`.padEnd(80) + '\n');
        }

        if (event.type === 'done') {
          process.stdout.write('\r');
        }

        if (event.type === 'error') {
          console.error(`\n  ⚠ Pipeline error: ${event.message}`);
        }

        if (event.type === 'snapshot_data' && snapshotWriter) {
          snapshotWriter(event.stepName as string, event.data);
        }
      } catch {
        // Ignore malformed SSE
      }
    }
  }

  const elapsed = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  console.log(`  完成 (${elapsed}s)`);

  if (!briefId) {
    const rows = d1Query(
      `SELECT id FROM briefs WHERE case_id = '${CASE_ID}' ORDER BY created_at DESC LIMIT 1`,
    );
    briefId = (rows[0]?.id as string) || null;
  }

  if (!briefId) {
    console.error('  ⚠ No brief found after pipeline!');
    return null;
  }

  console.log(`  Brief ID: ${briefId}`);
  return { briefId, elapsed, sseEvents, snapshotDir };
};

// ══════════════════════════════════════════════════════════
//  Citation Analysis
// ══════════════════════════════════════════════════════════

interface SectionAnalysis {
  label: string;
  lawCites: number;
  fileCites: number;
  charCount: number;
}

interface BriefAnalysis {
  briefId: string;
  numParagraphs: number;
  totalLaw: number;
  totalFile: number;
  totalCites: number;
  totalChars: number;
  zeroLawContent: string;
  zeroCiteAll: string;
  sections: SectionAnalysis[];
  elapsed?: number;
}

const analyzeBrief = (briefId: string): BriefAnalysis | null => {
  const rows = d1Query(`SELECT content_structured, case_id FROM briefs WHERE id = '${briefId}'`);
  if (!rows[0]?.content_structured) return null;

  const disputeMap = new Map<string, string>();
  if (rows[0].case_id) {
    const disputes = d1Query(`SELECT id, title FROM disputes WHERE case_id = '${rows[0].case_id}'`);
    for (const d of disputes) disputeMap.set(d.id as string, d.title as string);
  }

  const cs = JSON.parse(rows[0].content_structured as string) as {
    paragraphs: Paragraph[];
  };
  const paragraphs = cs.paragraphs || [];

  // Use shared buildQualityReport for statistics
  const report = buildQualityReport(paragraphs);

  // Map to SectionAnalysis with dispute labels (needs D1 data)
  const sections: SectionAnalysis[] = paragraphs.map((p, i) => {
    let label = p.subsection ? `${p.section} > ${p.subsection}` : p.section;
    if (!p.subsection && p.dispute_id && disputeMap.has(p.dispute_id)) {
      label = `${p.section} [${disputeMap.get(p.dispute_id)}]`;
    }
    const sq = report.perSection[i];
    return { label, lawCites: sq.lawCites, fileCites: sq.fileCites, charCount: sq.charCount };
  });

  return {
    briefId,
    numParagraphs: report.totalParagraphs,
    totalLaw: report.totalLawCites,
    totalFile: report.totalFileCites,
    totalCites: report.totalCites,
    totalChars: report.totalChars,
    zeroLawContent: `${report.zeroLawContentSections}/${report.contentSectionCount}`,
    zeroCiteAll: `${report.zeroCiteAllSections}/${report.allSectionCount}`,
    sections,
  };
};

// ══════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════

const main = async () => {
  console.log('═══ Pipeline Integration Benchmark ═══');
  console.log(`Case ID: ${CASE_ID}`);
  console.log(`Runs: ${NUM_RUNS}`);
  console.log(`Server: ${BASE_URL}`);
  if (SAVE_SNAPSHOTS) console.log('Snapshots: enabled');
  console.log('');

  try {
    const healthResp = await fetch(`${BASE_URL}/api/cases`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    if (!healthResp.ok) throw new Error(`HTTP ${healthResp.status}`);
    console.log('✓ Dev server is running');
  } catch {
    console.error(`✗ Cannot reach dev server at ${BASE_URL}`);
    console.error('  Please run "npm run dev" first');
    process.exit(1);
  }

  const baselineBriefs = d1Query(
    `SELECT id FROM briefs WHERE case_id = '${CASE_ID}' ORDER BY created_at DESC LIMIT 1`,
  );
  const baselineId = baselineBriefs[0]?.id as string | undefined;
  const baseline = baselineId ? analyzeBrief(baselineId) : null;

  const results: BriefAnalysis[] = [];
  for (let i = 0; i < NUM_RUNS; i++) {
    try {
      const runResult = await runPipeline(i);
      if (runResult) {
        const analysis = analyzeBrief(runResult.briefId);
        if (analysis) {
          analysis.elapsed = runResult.elapsed;
          results.push(analysis);
        }
      }
    } catch (err) {
      console.error(`\n  ✗ Run ${i + 1} failed: ${(err as Error).message}`);
    }
  }

  if (results.length === 0) {
    console.error('\nNo successful runs!');
    process.exit(1);
  }

  // ── Output Comparison Table ──
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log(' Benchmark Results');
  console.log('═══════════════════════════════════════════════════════════\n');

  const cols = ['Metric'];
  if (baseline) cols.push('Baseline');
  for (let i = 0; i < results.length; i++) cols.push(`Run ${i + 1}`);
  cols.push('Avg');

  const pad = (s: unknown, w: number): string => String(s).padStart(w);
  const COL_W = 12;

  console.log(cols.map((c) => pad(c, COL_W)).join(' │ '));
  console.log(cols.map(() => '─'.repeat(COL_W)).join('─┼─'));

  const metrics: { name: string; key: keyof BriefAnalysis }[] = [
    { name: 'Law cites', key: 'totalLaw' },
    { name: 'File cites', key: 'totalFile' },
    { name: 'Total cites', key: 'totalCites' },
    { name: 'Paragraphs', key: 'numParagraphs' },
    { name: 'Total chars', key: 'totalChars' },
    { name: '0-law content', key: 'zeroLawContent' },
    { name: '0-cite all', key: 'zeroCiteAll' },
    { name: 'Time (s)', key: 'elapsed' },
  ];

  for (const metric of metrics) {
    const row = [pad(metric.name, COL_W)];
    if (baseline) row.push(pad(baseline[metric.key] ?? '-', COL_W));
    for (const r of results) row.push(pad(r[metric.key] ?? '-', COL_W));

    const numericVals = results
      .map((r) => r[metric.key])
      .filter((v): v is number => typeof v === 'number');
    if (numericVals.length > 0) {
      const avg = (numericVals.reduce((s, v) => s + v, 0) / numericVals.length).toFixed(1);
      row.push(pad(avg, COL_W));
    } else {
      row.push(pad('-', COL_W));
    }

    console.log(row.join(' │ '));
  }

  // Per-section detail for each run
  console.log('\n\n── Per-Section Details ──\n');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`Run ${i + 1} (${r.briefId}):`);
    for (const sec of r.sections) {
      const lawStr = sec.lawCites === 0 ? '⚠ 0' : String(sec.lawCites);
      console.log(`  ${sec.label.padEnd(40)} law=${lawStr.padEnd(4)} file=${sec.fileCites}`);
    }
    console.log('');
  }

  // ── Save to JSON ──
  const report = {
    caseId: CASE_ID,
    timestamp: new Date().toISOString(),
    numRuns: NUM_RUNS,
    baseline: baseline ? { briefId: baseline.briefId, ...baseline } : null,
    runs: results,
  };

  const reportPath = resolve('scripts/pipeline-test/benchmark-results.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Results saved to: ${reportPath}`);
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
