/**
 * Replay Step 2 (Reasoning + Strategy) from snapshots.
 *
 * Restores ContextStore from step0+step1 snapshots, then re-runs
 * runReasoningStrategy() N times. Collects enrichment stats for each run
 * and outputs a comparison table.
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/replay-step2.ts --snapshot-dir snapshots/z4keVNf-20260304/ [--runs 5]
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { ContextStore } from '../../src/server/agent/contextStore';
import {
  runReasoningStrategy,
  type ReasoningStrategyProgressCallback,
} from '../../src/server/agent/pipeline/reasoningStrategyStep';
import { truncateLawContent } from '../../src/server/agent/pipeline/lawFetchStep';
import { getSectionKey } from '../../src/server/agent/pipeline/writerStep';
import type {
  ReasoningStrategyInput,
  ReasoningStrategyOutput,
  FetchedLaw,
  EnrichmentStats,
} from '../../src/server/agent/pipeline/types';
import { emptyEnrichmentStats } from '../../src/server/agent/pipeline/types';
import { createStubContext } from './stub-context';
import { createSnapshotWriter } from './snapshot-writer';
import { parseArgs, loadSnapshotJson } from './_helpers';

// ── Args ──

const { getArg } = parseArgs();

const SNAPSHOT_DIR = getArg('--snapshot-dir', '');
if (!SNAPSHOT_DIR) {
  console.error('Usage: npx tsx replay-step2.ts --snapshot-dir <path> [--runs N]');
  process.exit(1);
}

const NUM_RUNS = parseInt(getArg('--runs', '1'), 10);
const snapshotDir = resolve(SNAPSHOT_DIR);

// ── Types ──

interface RunResult {
  runIndex: number;
  elapsed: number;
  enrichmentStats: EnrichmentStats;
  claimStats: {
    total: number;
    ours: number;
    theirs: number;
    rebuttals: number;
    unrebutted: number;
  };
  sectionStats: {
    total: number;
    withLaws: number;
    withFiles: number;
    totalLawIds: number;
    totalFileIds: number;
  };
  sections: Array<{
    key: string;
    lawCount: number;
    fileCount: number;
    claimCount: number;
    hasDisputeId: boolean;
    hasSubsection: boolean;
  }>;
}

// ── Load Snapshots (once) ──

const loadSnapshots = () => {
  const step0 = loadSnapshotJson(snapshotDir, 'step0.json');
  const step0Store = ContextStore.fromSnapshot(
    step0.store as Parameters<typeof ContextStore.fromSnapshot>[0],
  );
  const parsedFiles = step0.parsedFiles as Array<{
    id: string;
    filename: string;
    category: string | null;
    parsedSummary: string | null;
  }>;
  const templateContentMd = (step0.templateContentMd as string | null) || null;

  const step1 = loadSnapshotJson(snapshotDir, 'step1.json');
  const step1Store = ContextStore.fromSnapshot(
    step1.store as Parameters<typeof ContextStore.fromSnapshot>[0],
  );
  const fetchedLawsArray = step1.fetchedLawsArray as FetchedLaw[];
  const userAddedLaws = step1.userAddedLaws as Array<{
    id: string;
    law_name: string;
    article_no: string;
    content: string;
  }>;

  return {
    step0Store,
    parsedFiles,
    templateContentMd,
    step1Store,
    fetchedLawsArray,
    userAddedLaws,
  };
};

// ── Single Run ──

const runOnce = async (
  runIndex: number,
  snapshots: ReturnType<typeof loadSnapshots>,
): Promise<{ result: RunResult; store: ContextStore }> => {
  // Create fresh store clone for each run
  const store = ContextStore.fromSnapshot(
    snapshots.step1Store.serialize() as Parameters<typeof ContextStore.fromSnapshot>[0],
  );

  const ctx = createStubContext({
    caseId: snapshots.step0Store.caseMetadata?.caseNumber || 'replay-stub',
    briefType: store.briefType,
  });

  const progress: ReasoningStrategyProgressCallback = {
    onReasoningStart: async () => {
      process.stdout.write('  → 推理中...');
    },
    onSearchLaw: async (query, _purpose, resultCount) => {
      process.stdout.write(`\r  → 補搜: ${query} (${resultCount} 條)`.padEnd(60));
    },
    onFinalized: async () => {
      process.stdout.write('\r  → 推理完成'.padEnd(60) + '\n');
    },
    onOutputStart: async () => {
      process.stdout.write('  → 策略輸出中...\n');
    },
  };

  const strategyInput: ReasoningStrategyInput = {
    caseSummary: store.caseSummary,
    briefType: store.briefType,
    legalIssues: store.legalIssues,
    informationGaps: store.informationGaps,
    fetchedLaws: snapshots.fetchedLawsArray
      .filter((l) => l.source !== 'user_manual')
      .map(truncateLawContent),
    fileSummaries: snapshots.parsedFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      category: f.category,
      summary: f.parsedSummary || '無摘要',
    })),
    damages: store.damages,
    timeline: store.timeline,
    userAddedLaws: snapshots.userAddedLaws,
    caseMetadata: store.caseMetadata,
  };

  const startTime = Date.now();

  const strategyOutput: ReasoningStrategyOutput = await runReasoningStrategy(
    ctx,
    store,
    strategyInput,
    progress,
    snapshots.templateContentMd,
  );

  const elapsed = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));

  // Apply to store
  store.setFoundLaws(snapshots.fetchedLawsArray);
  store.setStrategyOutput(strategyOutput.claims, strategyOutput.sections);

  // Collect stats
  const enrichmentStats: EnrichmentStats = strategyOutput.enrichmentStats || emptyEnrichmentStats();

  const ourClaims = strategyOutput.claims.filter((c) => c.side === 'ours');
  const theirClaims = strategyOutput.claims.filter((c) => c.side === 'theirs');
  const rebuttals = strategyOutput.claims.filter((c) => c.claim_type === 'rebuttal');
  const unrebutted = store.getUnrebutted();

  const sections = strategyOutput.sections.map((sec) => ({
    key: getSectionKey(sec.section, sec.subsection),
    lawCount: sec.relevant_law_ids?.length || 0,
    fileCount: sec.relevant_file_ids?.length || 0,
    claimCount: sec.claims?.length || 0,
    hasDisputeId: !!sec.dispute_id,
    hasSubsection: !!sec.subsection,
  }));

  return {
    result: {
      runIndex,
      elapsed,
      enrichmentStats,
      claimStats: {
        total: strategyOutput.claims.length,
        ours: ourClaims.length,
        theirs: theirClaims.length,
        rebuttals: rebuttals.length,
        unrebutted: unrebutted.length,
      },
      sectionStats: {
        total: strategyOutput.sections.length,
        withLaws: strategyOutput.sections.filter((s) => (s.relevant_law_ids?.length || 0) > 0)
          .length,
        withFiles: strategyOutput.sections.filter((s) => (s.relevant_file_ids?.length || 0) > 0)
          .length,
        totalLawIds: strategyOutput.sections.reduce(
          (sum, s) => sum + (s.relevant_law_ids?.length || 0),
          0,
        ),
        totalFileIds: strategyOutput.sections.reduce(
          (sum, s) => sum + (s.relevant_file_ids?.length || 0),
          0,
        ),
      },
      sections,
    },
    store,
  };
};

// ── Output ──

const pad = (s: unknown, w: number): string => String(s).padStart(w);
const COL_W = 10;

type MetricDef = { label: string; getValue: (r: RunResult) => number };

const printTable = (title: string, metrics: MetricDef[], results: RunResult[]) => {
  console.log(`\n═══ ${title} ═══\n`);

  const header = [pad('Metric', 16)];
  for (let i = 0; i < results.length; i++) header.push(pad(`Run ${i + 1}`, COL_W));
  if (results.length > 1) header.push(pad('Avg', COL_W));
  console.log(header.join(' │ '));
  console.log(header.map((_, i) => (i === 0 ? '─'.repeat(16) : '─'.repeat(COL_W))).join('─┼─'));

  for (const metric of metrics) {
    const row = [pad(metric.label, 16)];
    const values: number[] = [];
    for (const r of results) {
      const v = metric.getValue(r);
      values.push(v);
      row.push(pad(v, COL_W));
    }
    if (results.length > 1) {
      const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
      row.push(pad(avg, COL_W));
    }
    console.log(row.join(' │ '));
  }
};

const ENRICHMENT_METRICS: MetricDef[] = [
  { label: 'dispute_id_fix', getValue: (r) => r.enrichmentStats.disputeIdFixed },
  { label: 'sec←claim', getValue: (r) => r.enrichmentStats.sectionDisputeFromClaim },
  { label: 'claim←sec', getValue: (r) => r.enrichmentStats.claimDisputeFromSection },
  { label: 'claim↔sec', getValue: (r) => r.enrichmentStats.claimConsistency },
  { label: 'legal_basis', getValue: (r) => r.enrichmentStats.legalBasis },
  { label: 'law_ids', getValue: (r) => r.enrichmentStats.lawIds },
  { label: 'subsection', getValue: (r) => r.enrichmentStats.subsection },
  { label: 'TOTAL', getValue: (r) => r.enrichmentStats.totalPatched },
];

const STRUCTURE_METRICS: MetricDef[] = [
  { label: 'Sections', getValue: (r) => r.sectionStats.total },
  { label: 'w/ laws', getValue: (r) => r.sectionStats.withLaws },
  { label: 'w/ files', getValue: (r) => r.sectionStats.withFiles },
  { label: 'Total law IDs', getValue: (r) => r.sectionStats.totalLawIds },
  { label: 'Total file IDs', getValue: (r) => r.sectionStats.totalFileIds },
  { label: 'Claims', getValue: (r) => r.claimStats.total },
  { label: 'Ours', getValue: (r) => r.claimStats.ours },
  { label: 'Theirs', getValue: (r) => r.claimStats.theirs },
  { label: 'Rebuttals', getValue: (r) => r.claimStats.rebuttals },
  { label: 'Unrebutted', getValue: (r) => r.claimStats.unrebutted },
  { label: 'Time (s)', getValue: (r) => r.elapsed },
];

const printSectionDetail = (results: RunResult[]) => {
  console.log('\n═══ Per-Section Details ═══\n');
  for (const r of results) {
    console.log(`Run ${r.runIndex + 1} (${r.elapsed}s):`);
    for (const sec of r.sections) {
      const lawStr = sec.lawCount === 0 ? '⚠ 0' : String(sec.lawCount);
      const dispStr = sec.hasDisputeId ? '✓' : '✗';
      const subStr = sec.hasSubsection ? '✓' : '-';
      console.log(
        `  ${sec.key.padEnd(40)} laws=${lawStr.padEnd(4)} files=${String(sec.fileCount).padEnd(3)} claims=${sec.claimCount} disp=${dispStr} sub=${subStr}`,
      );
    }
    console.log('');
  }
};

// ── Main ──

const main = async () => {
  console.log('═══ Replay Step 2 (Reasoning + Strategy) ═══');
  console.log(`Snapshot dir: ${snapshotDir}`);
  console.log(`Runs: ${NUM_RUNS}\n`);

  const snapshots = loadSnapshots();

  console.log(`  parsedFiles: ${snapshots.parsedFiles.length}`);
  console.log(
    `  templateContentMd: ${snapshots.templateContentMd ? `${snapshots.templateContentMd.length} chars` : 'none'}`,
  );
  console.log(`  legalIssues: ${snapshots.step1Store.legalIssues.length}`);
  console.log(`  fetchedLaws: ${snapshots.fetchedLawsArray.length}`);
  console.log(`  userAddedLaws: ${snapshots.userAddedLaws.length}`);

  const results: RunResult[] = [];
  let lastStore: ContextStore | null = null;

  for (let i = 0; i < NUM_RUNS; i++) {
    console.log(`\n── Run ${i + 1}/${NUM_RUNS} ──`);
    try {
      const { result, store } = await runOnce(i, snapshots);
      results.push(result);
      lastStore = store;
      console.log(`  完成 (${result.elapsed}s)`);
    } catch (err) {
      console.error(`  ✗ Run ${i + 1} failed: ${(err as Error).message}`);
    }
  }

  if (results.length === 0 || !lastStore) {
    console.error('\nNo successful runs!');
    process.exit(1);
  }

  // ── Save step2.json snapshot (from last successful run) ──
  const saveSnapshot = createSnapshotWriter(snapshotDir);
  saveSnapshot('step2', { store: lastStore.serialize() });

  // ── Output Tables ──
  printTable('Enrichment Stats', ENRICHMENT_METRICS, results);
  printTable('Structure Stats', STRUCTURE_METRICS, results);
  printSectionDetail(results);

  // ── Save JSON ──
  const report = {
    timestamp: new Date().toISOString(),
    snapshotDir,
    numRuns: NUM_RUNS,
    successfulRuns: results.length,
    runs: results,
    averages:
      results.length > 1
        ? {
            enrichment: Object.fromEntries(
              (
                [
                  'disputeIdFixed',
                  'sectionDisputeFromClaim',
                  'claimDisputeFromSection',
                  'claimConsistency',
                  'legalBasis',
                  'lawIds',
                  'subsection',
                  'totalPatched',
                ] as (keyof EnrichmentStats)[]
              ).map((key) => [
                key,
                parseFloat(
                  (
                    results.reduce((sum, r) => sum + r.enrichmentStats[key], 0) / results.length
                  ).toFixed(1),
                ),
              ]),
            ),
            elapsed: parseFloat(
              (results.reduce((sum, r) => sum + r.elapsed, 0) / results.length).toFixed(1),
            ),
          }
        : null,
  };

  const outPath = `${snapshotDir}/replay-step2-benchmark.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nResults saved to: ${outPath}`);
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
