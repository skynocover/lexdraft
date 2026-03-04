/**
 * Headless Pipeline Benchmark
 *
 * Directly calls runBriefPipeline() with real D1 via getPlatformProxy(),
 * no dev server required. Supports parallel runs.
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/headless-benchmark.ts [options]
 *
 * Options:
 *   --runs N          Number of runs (default 3)
 *   --parallel N      Max concurrency (default = runs)
 *   --case-id XXX     Test case ID (default z4keVNfyuKvL68Xg1qPl2)
 *   --save-snapshots  Save step snapshots to disk
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { getPlatformProxy } from 'wrangler';
import { runBriefPipeline } from '../../src/server/agent/briefPipeline';
import { buildQualityReport } from '../../src/server/agent/pipeline/qualityReport';
import { getDB } from '../../src/server/db';
import type { PipelineContext } from '../../src/server/agent/pipeline/types';
import type { Paragraph } from '../../src/client/stores/useBriefStore';
import { createSnapshotWriter } from './snapshot-writer';
import { parseArgs, loadDevVars } from './_helpers';

// ══════════════════════════════════════════════════════════
//  Config
// ══════════════════════════════════════════════════════════

const { getArg, hasFlag } = parseArgs();

const NUM_RUNS = parseInt(getArg('--runs', '3'), 10);
const PARALLEL = parseInt(getArg('--parallel', String(NUM_RUNS)), 10);
const CASE_ID = getArg('--case-id', 'z4keVNfyuKvL68Xg1qPl2');
const SAVE_SNAPSHOTS = hasFlag('--save-snapshots');

// ══════════════════════════════════════════════════════════
//  Worktree-aware persist path
// ══════════════════════════════════════════════════════════

const getMainWorktreePath = (): string => {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
    // First "worktree" line is the main worktree
    const match = output.match(/^worktree (.+)$/m);
    if (match) return match[1];
  } catch {
    /* not in a worktree */
  }
  return process.cwd();
};

// ══════════════════════════════════════════════════════════
//  D1 + Context Setup
// ══════════════════════════════════════════════════════════

interface PlatformBindings {
  DB: D1Database;
  [key: string]: unknown;
}

const setupPlatform = async () => {
  const mainPath = getMainWorktreePath();
  const persistPath = resolve(mainPath, '.wrangler/state/v3');

  console.log(`D1 persist path: ${persistPath}`);

  const proxy = await getPlatformProxy<PlatformBindings>({
    configPath: resolve(process.cwd(), 'wrangler.jsonc'),
    persist: { path: persistPath },
  });

  return proxy;
};

const createPipelineContext = (
  db: D1Database,
  runIndex: number,
  snapshotWriter?: ((stepName: string, data: unknown) => void) | null,
): PipelineContext => {
  const vars = loadDevVars();

  const sendSSE: PipelineContext['sendSSE'] = async (event) => {
    // Log progress events
    if (event.type === 'pipeline_progress') {
      const steps = (event as Record<string, unknown>).steps as
        | { status: string; label: string }[]
        | undefined;
      if (steps) {
        const current = steps.find((s) => s.status === 'running');
        const done = steps.filter((s) => s.status === 'done').length;
        if (current) {
          process.stdout.write(
            `\r  [Run ${runIndex + 1}] [${done}/${steps.length}] ${current.label}...`.padEnd(80),
          );
        }
      }
    }
    if (event.type === 'brief_update') {
      const evt = event as Record<string, unknown>;
      if (evt.action === 'add_paragraph') {
        const data = evt.data as { section?: string; subsection?: string } | undefined;
        const sec = data?.section || '?';
        const sub = data?.subsection ? ' > ' + data.subsection : '';
        process.stdout.write(`\r  [Run ${runIndex + 1}] paragraph: ${sec}${sub}`.padEnd(80) + '\n');
      }
    }
  };

  return {
    caseId: CASE_ID,
    briefType: '準備書狀',
    title: 'Headless Benchmark',
    signal: new AbortController().signal,
    sendSSE,
    db,
    drizzle: getDB(db),
    aiEnv: {
      CF_ACCOUNT_ID: vars.CF_ACCOUNT_ID || '',
      CF_GATEWAY_ID: vars.CF_GATEWAY_ID || '',
      CF_AIG_TOKEN: vars.CF_AIG_TOKEN || '',
    },
    mongoUrl: vars.MONGO_URL || '',
    mongoApiKey: vars.MONGO_API_KEY,
  };
};

// ══════════════════════════════════════════════════════════
//  Pipeline Runner
// ══════════════════════════════════════════════════════════

interface RunResult {
  runIndex: number;
  briefId: string;
  elapsed: number;
  snapshotDir?: string;
}

const runSingle = async (db: D1Database, runIndex: number): Promise<RunResult | null> => {
  let snapshotWriter: ((stepName: string, data: unknown) => void) | null = null;
  let snapshotDir: string | undefined;

  if (SAVE_SNAPSHOTS) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    snapshotDir = resolve(`snapshots/${CASE_ID}-${ts}-run${runIndex + 1}`);
    snapshotWriter = createSnapshotWriter(snapshotDir);
    console.log(`  [Run ${runIndex + 1}] Snapshots -> ${snapshotDir}`);
  }

  console.log(`\n── Run ${runIndex + 1}/${NUM_RUNS} ──`);

  const ctx = createPipelineContext(db, runIndex, snapshotWriter);
  const startTime = Date.now();

  const result = await runBriefPipeline(ctx, {
    onStepComplete: snapshotWriter || undefined,
  });

  const elapsed = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  process.stdout.write('\r');
  console.log(`  [Run ${runIndex + 1}] Done (${elapsed}s) — ${result.result}`);

  // Find the most recent brief for this case
  const rawResult = await db
    .prepare('SELECT id FROM briefs WHERE case_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(CASE_ID)
    .first<{ id: string }>();

  const briefId = rawResult?.id;
  if (!briefId) {
    console.error(`  [Run ${runIndex + 1}] No brief found after pipeline!`);
    return null;
  }

  console.log(`  [Run ${runIndex + 1}] Brief ID: ${briefId}`);
  return { runIndex, briefId, elapsed, snapshotDir };
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

const analyzeBrief = async (db: D1Database, briefId: string): Promise<BriefAnalysis | null> => {
  const row = await db
    .prepare('SELECT content_structured, case_id FROM briefs WHERE id = ?')
    .bind(briefId)
    .first<{ content_structured: string; case_id: string }>();

  if (!row?.content_structured) return null;

  // Get dispute titles for section labels
  const disputeMap = new Map<string, string>();
  if (row.case_id) {
    const disputeRows = await db
      .prepare('SELECT id, title FROM disputes WHERE case_id = ?')
      .bind(row.case_id)
      .all<{ id: string; title: string }>();
    for (const d of disputeRows.results) {
      disputeMap.set(d.id, d.title);
    }
  }

  const cs = JSON.parse(row.content_structured) as { paragraphs: Paragraph[] };
  const paragraphs = cs.paragraphs || [];

  const report = buildQualityReport(paragraphs);

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
//  Promise Pool (concurrency limiter, no new deps)
// ══════════════════════════════════════════════════════════

const promisePool = async <T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<(T | null)[]> => {
  const results: (T | null)[] = new Array(tasks.length).fill(null);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      try {
        results[i] = await tasks[i]();
      } catch (err) {
        console.error(`Task ${i} failed: ${(err as Error).message}`);
        results[i] = null;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
};

// ══════════════════════════════════════════════════════════
//  Main
// ══════════════════════════════════════════════════════════

const main = async () => {
  console.log('═══ Headless Pipeline Benchmark ═══');
  console.log(`Case ID: ${CASE_ID}`);
  console.log(`Runs: ${NUM_RUNS}`);
  console.log(`Parallel: ${PARALLEL}`);
  if (SAVE_SNAPSHOTS) console.log('Snapshots: enabled');
  console.log('');

  // Set up platform proxy (shared across all runs)
  const proxy = await setupPlatform();
  const db = proxy.env.DB;

  if (!db) {
    console.error('Failed to get D1 binding from getPlatformProxy');
    await proxy.dispose();
    process.exit(1);
  }

  console.log('D1 binding ready\n');

  // Analyze baseline (most recent existing brief)
  const baselineRow = await db
    .prepare('SELECT id FROM briefs WHERE case_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(CASE_ID)
    .first<{ id: string }>();
  const baseline = baselineRow ? await analyzeBrief(db, baselineRow.id) : null;

  // Run pipelines
  const tasks = Array.from({ length: NUM_RUNS }, (_, i) => () => runSingle(db, i));
  const runResults = await promisePool(tasks, PARALLEL);

  // Analyze results
  const analyses: BriefAnalysis[] = [];
  for (const r of runResults) {
    if (!r) continue;
    const analysis = await analyzeBrief(db, r.briefId);
    if (analysis) {
      analysis.elapsed = r.elapsed;
      analyses.push(analysis);
    }
  }

  if (analyses.length === 0) {
    console.error('\nNo successful runs!');
    await proxy.dispose();
    process.exit(1);
  }

  // ── Output Comparison Table ──
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log(' Benchmark Results');
  console.log('═══════════════════════════════════════════════════════════\n');

  const cols = ['Metric'];
  if (baseline) cols.push('Baseline');
  for (let i = 0; i < analyses.length; i++) cols.push(`Run ${i + 1}`);
  cols.push('Avg');

  const pad = (s: unknown, w: number): string => String(s).padStart(w);
  const COL_W = 12;

  console.log(cols.map((c) => pad(c, COL_W)).join(' | '));
  console.log(cols.map(() => '-'.repeat(COL_W)).join('-+-'));

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
    for (const r of analyses) row.push(pad(r[metric.key] ?? '-', COL_W));

    const numericVals = analyses
      .map((r) => r[metric.key])
      .filter((v): v is number => typeof v === 'number');
    if (numericVals.length > 0) {
      const avg = (numericVals.reduce((s, v) => s + v, 0) / numericVals.length).toFixed(1);
      row.push(pad(avg, COL_W));
    } else {
      row.push(pad('-', COL_W));
    }

    console.log(row.join(' | '));
  }

  // Per-section detail for each run
  console.log('\n\n── Per-Section Details ──\n');
  for (let i = 0; i < analyses.length; i++) {
    const r = analyses[i];
    console.log(`Run ${i + 1} (${r.briefId}):`);
    for (const sec of r.sections) {
      const lawStr = sec.lawCites === 0 ? '!! 0' : String(sec.lawCites);
      console.log(`  ${sec.label.padEnd(40)} law=${lawStr.padEnd(4)} file=${sec.fileCites}`);
    }
    console.log('');
  }

  // ── Save to JSON ──
  const report = {
    caseId: CASE_ID,
    timestamp: new Date().toISOString(),
    numRuns: NUM_RUNS,
    parallel: PARALLEL,
    baseline: baseline ? { briefId: baseline.briefId, ...baseline } : null,
    runs: analyses,
  };

  const reportPath = resolve('scripts/pipeline-test/headless-benchmark-results.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Results saved to: ${reportPath}`);

  await proxy.dispose();
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
