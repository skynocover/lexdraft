/**
 * Generate Step 0 + Step 1 snapshots (no AI cost beyond Gemini Flash).
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/generate-snapshots.ts [--case-id XXX]
 */

import { resolve } from 'path';
import { getPlatformProxy } from 'wrangler';
import { ContextStore } from '../../src/server/agent/contextStore';
import { runCaseAnalysis } from '../../src/server/agent/pipeline/caseAnalysisStep';
import { runLawFetch } from '../../src/server/agent/pipeline/lawFetchStep';
import { mapToJson } from '../../src/server/agent/pipeline/snapshotUtils';
import { getDB } from '../../src/server/db';
import type { PipelineContext } from '../../src/server/agent/pipeline/types';
import { createSnapshotWriter } from './snapshot-writer';
import { parseArgs, loadDevVars, getMainWorktreePath } from './_helpers';

// ── Config ──

const { getArg } = parseArgs();
const CASE_ID = getArg('--case-id', 'z4keVNfyuKvL68Xg1qPl2');

// ── Main ──

const main = async () => {
  console.log('═══ Generate Step 0 + Step 1 Snapshots ═══');
  console.log(`Case ID: ${CASE_ID}\n`);

  // D1 setup
  const mainPath = getMainWorktreePath();
  const persistPath = resolve(mainPath, '.wrangler/state/v3');
  console.log(`D1 persist path: ${persistPath}`);

  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: resolve(process.cwd(), 'wrangler.jsonc'),
    persist: { path: persistPath },
  });
  const db = proxy.env.DB;
  if (!db) {
    console.error('Failed to get D1 binding');
    await proxy.dispose();
    process.exit(1);
  }
  console.log('D1 binding ready\n');

  const vars = loadDevVars();
  const drizzle = getDB(db);

  const ctx: PipelineContext = {
    caseId: CASE_ID,
    briefType: '準備書狀',
    title: 'Snapshot Generation',
    signal: new AbortController().signal,
    sendSSE: async () => {},
    db,
    drizzle,
    aiEnv: {
      CF_ACCOUNT_ID: vars.CF_ACCOUNT_ID || '',
      CF_GATEWAY_ID: vars.CF_GATEWAY_ID || '',
      CF_AIG_TOKEN: vars.CF_AIG_TOKEN || '',
    },
    mongoUrl: vars.MONGO_URL || '',
    mongoApiKey: vars.MONGO_API_KEY,
  };

  // Snapshot writer
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const snapshotDir = resolve(`scripts/pipeline-test/snapshots/${CASE_ID}-${ts}`);
  const saveSnapshot = createSnapshotWriter(snapshotDir);

  // ═══ Step 0: Case Analysis ═══
  console.log('── Step 0: Case Analysis ──');
  const store = new ContextStore();
  const startStep0 = Date.now();

  const step0 = await runCaseAnalysis(ctx, store, {
    setChildren: () => {},
  });

  const step0Elapsed = ((Date.now() - startStep0) / 1000).toFixed(1);
  console.log(`  完成 (${step0Elapsed}s)`);
  console.log(`  legalIssues: ${store.legalIssues.length}`);
  console.log(`  parsedFiles: ${step0.parsedFiles.length}`);

  const userAddedLaws = step0.allLawRefRows
    .filter((r) => r.is_manual && r.full_text)
    .map((r) => ({
      id: r.id,
      law_name: r.law_name,
      article_no: r.article,
      content: r.full_text,
    }));

  saveSnapshot('step0', {
    store: store.serialize(),
    briefId: step0.briefId,
    parsedFiles: step0.parsedFiles,
    allLawRefRows: step0.allLawRefRows,
    templateContentMd: step0.templateContentMd,
    fileContentMap: mapToJson(step0.fileContentMap),
  });

  // ═══ Step 1: Law Fetch ═══
  console.log('\n── Step 1: Law Fetch ──');
  const startStep1 = Date.now();

  const lawFetchResult = await runLawFetch(
    ctx.mongoUrl,
    {
      legalIssues: store.legalIssues,
      userAddedLaws: step0.allLawRefRows.filter((r) => r.is_manual),
      existingLawRefs: step0.allLawRefRows,
    },
    ctx.mongoApiKey,
  );

  const fetchedLawsArray = [...lawFetchResult.laws.values()];
  const step1Elapsed = ((Date.now() - startStep1) / 1000).toFixed(1);
  console.log(`  完成 (${step1Elapsed}s)`);
  console.log(`  fetchedLaws: ${fetchedLawsArray.length}`);
  console.log(`  法條: ${fetchedLawsArray.map((l) => `${l.law_name} ${l.article_no}`).join(', ')}`);

  saveSnapshot('step1', {
    store: store.serialize(),
    fetchedLawsArray,
    userAddedLaws,
  });

  console.log(`\n✓ Snapshots saved to: ${snapshotDir}`);
  console.log(
    '  Now run: npx tsx scripts/pipeline-test/replay-step2.ts --snapshot-dir ' +
      snapshotDir +
      ' --runs 3',
  );

  await proxy.dispose();
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
