/**
 * Replay Step 2 (Reasoning + Strategy) from snapshots.
 *
 * Restores ContextStore from step0+step1 snapshots, then re-runs
 * runReasoningStrategy(). Outputs claims/sections statistics and saves results.
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/replay-step2.ts --snapshot-dir snapshots/z4keVNf-20260304/
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
} from '../../src/server/agent/pipeline/types';
import { createStubContext } from './stub-context';
import { parseArgs, loadSnapshotJson } from './_helpers';

// ── Args ──

const { getArg } = parseArgs();

const SNAPSHOT_DIR = getArg('--snapshot-dir', '');
if (!SNAPSHOT_DIR) {
  console.error('Usage: npx tsx replay-step2.ts --snapshot-dir <path>');
  process.exit(1);
}

const snapshotDir = resolve(SNAPSHOT_DIR);

const main = async () => {
  console.log('═══ Replay Step 2 (Reasoning + Strategy) ═══');
  console.log(`Snapshot dir: ${snapshotDir}\n`);

  // Step 0: parsedFiles + templateContentMd
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

  console.log(`  parsedFiles: ${parsedFiles.length}`);
  console.log(
    `  templateContentMd: ${templateContentMd ? `${templateContentMd.length} chars` : 'none'}`,
  );

  // Step 1: fetchedLawsArray + userAddedLaws + store
  const step1 = loadSnapshotJson(snapshotDir, 'step1.json');
  const store = ContextStore.fromSnapshot(
    step1.store as Parameters<typeof ContextStore.fromSnapshot>[0],
  );
  const fetchedLawsArray = step1.fetchedLawsArray as FetchedLaw[];
  const userAddedLaws = step1.userAddedLaws as Array<{
    id: string;
    law_name: string;
    article_no: string;
    content: string;
  }>;

  console.log(`  legalIssues: ${store.legalIssues.length}`);
  console.log(`  fetchedLaws: ${fetchedLawsArray.length}`);
  console.log(`  userAddedLaws: ${userAddedLaws.length}`);
  console.log('');

  // Build stub context
  const ctx = createStubContext({
    caseId: step0Store.caseMetadata?.caseNumber || 'replay-stub',
    briefType: store.briefType,
  });

  // Progress callback (console output)
  const progress: ReasoningStrategyProgressCallback = {
    onReasoningStart: async () => {
      console.log('  → AI 法律推理中...');
    },
    onSearchLaw: async (query, purpose, resultCount, lawNames) => {
      const detail = resultCount > 0 ? `${resultCount} 條（${query}）` : `未找到（${query}）`;
      console.log(`  → 補搜：${purpose} — ${detail}`);
      if (lawNames.length > 0) {
        console.log(`    ${lawNames.join(', ')}`);
      }
    },
    onFinalized: async () => {
      console.log('  → 推理完成，輸出策略...');
    },
    onOutputStart: async () => {
      console.log('  → 策略輸出中...');
    },
  };

  // Assemble strategyInput (same logic as briefPipeline.ts:267-285)
  const strategyInput: ReasoningStrategyInput = {
    caseSummary: store.caseSummary,
    briefType: store.briefType,
    legalIssues: store.legalIssues,
    informationGaps: store.informationGaps,
    fetchedLaws: fetchedLawsArray.filter((l) => l.source !== 'user_manual').map(truncateLawContent),
    fileSummaries: parsedFiles.map((f) => ({
      id: f.id,
      filename: f.filename,
      category: f.category,
      summary: f.parsedSummary || '無摘要',
    })),
    damages: store.damages,
    timeline: store.timeline,
    userAddedLaws,
    caseMetadata: store.caseMetadata,
  };

  // ── Run Reasoning ──

  const startTime = Date.now();

  const strategyOutput: ReasoningStrategyOutput = await runReasoningStrategy(
    ctx,
    store,
    strategyInput,
    progress,
    templateContentMd,
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Apply to store (same as briefPipeline.ts:296-301)
  store.setFoundLaws(fetchedLawsArray);
  store.setStrategyOutput(strategyOutput.claims, strategyOutput.sections);

  // ── Output Statistics ──

  const ourClaims = strategyOutput.claims.filter((c) => c.side === 'ours');
  const theirClaims = strategyOutput.claims.filter((c) => c.side === 'theirs');
  const rebuttals = strategyOutput.claims.filter((c) => c.claim_type === 'rebuttal');
  const unrebutted = store.getUnrebutted();

  console.log(`\n── Results (${elapsed}s) ──\n`);
  console.log(`  Claims:     ${strategyOutput.claims.length} total`);
  console.log(`    Ours:     ${ourClaims.length}`);
  console.log(`    Theirs:   ${theirClaims.length}`);
  console.log(`    Rebuttals: ${rebuttals.length}`);
  console.log(`    Unrebutted: ${unrebutted.length}`);
  console.log(`  Sections:   ${strategyOutput.sections.length}`);
  console.log('');

  for (const sec of strategyOutput.sections) {
    const key = getSectionKey(sec.section, sec.subsection);
    const lawCount = sec.relevant_law_ids?.length || 0;
    const fileCount = sec.relevant_file_ids?.length || 0;
    const claimCount = sec.claims?.length || 0;
    console.log(
      `  ${key.padEnd(40)} laws=${String(lawCount).padEnd(3)} files=${String(fileCount).padEnd(3)} claims=${claimCount}`,
    );
  }

  // ── Save results ──

  const result = {
    timestamp: new Date().toISOString(),
    snapshotDir,
    elapsed: parseFloat(elapsed),
    store: store.serialize(),
    strategyInput,
    strategyOutput,
    stats: {
      totalClaims: strategyOutput.claims.length,
      ourClaims: ourClaims.length,
      theirClaims: theirClaims.length,
      rebuttals: rebuttals.length,
      unrebutted: unrebutted.length,
      sections: strategyOutput.sections.length,
    },
  };

  const outPath = `${snapshotDir}/replay-step2.json`;
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to: ${outPath}`);
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
