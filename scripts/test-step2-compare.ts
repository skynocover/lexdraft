/**
 * Step 2 A/B Test: Compare pipeline quality with different Step 0 outputs.
 *
 * Loads D1 case data, uses saved Step 0 outputs from two models,
 * runs Step 1 (law fetch) + Step 2 (reasoning + structuring) for each,
 * and compares the results.
 *
 * Usage:
 *   npx tsx scripts/test-step2-compare.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { getPlatformProxy } from 'wrangler';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { ContextStore } from '../src/server/agent/contextStore';
import { runLawFetch, truncateLawContent } from '../src/server/agent/pipeline/lawFetchStep';
import {
  runReasoningStrategy,
  type ReasoningStrategyProgressCallback,
} from '../src/server/agent/pipeline/reasoningStrategyStep';
import { getSectionKey } from '../src/server/agent/pipeline/writerStep';
import { getDB } from '../src/server/db';
import { files, cases, damages as damagesTable } from '../src/server/db/schema';
import { readLawRefs } from '../src/server/lib/lawRefsJson';
import { parseJsonField } from '../src/server/agent/toolHelpers';
import type {
  LegalIssue,
  InformationGap,
  ReasoningStrategyInput,
  ReasoningStrategyOutput,
  FetchedLaw,
  TimelineItem,
  DamageItem,
  PipelineContext,
} from '../src/server/agent/pipeline/types';

// ── Config ──

const CASE_ID = 'z4keVNfyuKvL68Xg1qPl2';

const MODEL_A_LABEL = 'Gemini 2.5 Flash';
const MODEL_A_FILE = resolve('scripts/step0-output-gemini-2-5-flash.json');

const MODEL_B_LABEL = 'Gemini 3.1 Flash Lite';
const MODEL_B_FILE = resolve('scripts/step0-output-gemini-3-1-flash-lite.json');

// ── Helpers ──

const getMainWorktreePath = (): string => {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
    const match = output.match(/^worktree (.+)$/m);
    if (match) return match[1];
  } catch {
    /* not in a worktree */
  }
  return process.cwd();
};

const loadDevVars = (): Record<string, string> => {
  const vars: Record<string, string> = {};
  const candidates = [resolve('.dev.vars'), resolve('dist/lexdraft/.dev.vars')];
  for (const path of candidates) {
    try {
      const content = readFileSync(path, 'utf-8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([A-Z_]+)\s*=\s*(.+)/);
        if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      break;
    } catch {
      /* try next */
    }
  }
  return vars;
};

const loadStep0Output = (filePath: string): { legalIssues: LegalIssue[]; informationGaps: InformationGap[] } => {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));

  const legalIssues: LegalIssue[] = (raw.legal_issues || []).map((issue: Record<string, unknown>) => ({
    id: nanoid(),
    title: (issue.title as string) || '未命名爭點',
    our_position: (issue.our_position as string) || '',
    their_position: (issue.their_position as string) || '',
    key_evidence: (issue.key_evidence as string[]) || [],
    mentioned_laws: (issue.mentioned_laws as string[]) || [],
    facts: ((issue.facts as Array<Record<string, unknown>>) || []).map((f) => ({
      id: nanoid(),
      description: (f.description as string) || '',
      assertion_type: (f.assertion_type as string) || '主張',
      source_side: (f.source_side as string) || '中立',
      evidence: (f.evidence as string[]) || [],
      disputed_by: (f.disputed_by_description as string) || null,
    })),
  }));

  const informationGaps: InformationGap[] = (raw.information_gaps || []).map((gap: Record<string, unknown>) => {
    const relatedIndex = (gap.related_issue_index as number) ?? 0;
    return {
      id: nanoid(),
      severity: (gap.severity === 'critical' ? 'critical' : 'nice_to_have') as 'critical' | 'nice_to_have',
      description: (gap.description as string) || '',
      related_issue_id: legalIssues[relatedIndex]?.id || '',
      suggestion: (gap.suggestion as string) || '',
    };
  });

  return { legalIssues, informationGaps };
};

// ── Run Result ──

interface RunResult {
  model: string;
  step1Elapsed: number;
  step2Elapsed: number;
  fetchedLawCount: number;
  supplementedLawCount: number;
  claims: {
    total: number;
    ours: number;
    theirs: number;
    rebuttals: number;
    unrebutted: number;
  };
  sections: Array<{
    key: string;
    lawCount: number;
    fileCount: number;
    claimCount: number;
    hasDisputeId: boolean;
    hasSubsection: boolean;
  }>;
  sectionStats: {
    total: number;
    withLaws: number;
    withFiles: number;
    totalLawIds: number;
    totalFileIds: number;
  };
}

// ── Main ──

const main = async () => {
  console.log('═══ Step 2 A/B Compare ═══');
  console.log(`Case ID: ${CASE_ID}`);
  console.log(`Model A: ${MODEL_A_LABEL}`);
  console.log(`Model B: ${MODEL_B_LABEL}\n`);

  // ── D1 Setup ──
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
  const drizzle = getDB(db);
  console.log('D1 binding ready\n');

  const vars = loadDevVars();

  // ── Load shared case data from D1 ──
  console.log('Loading case data from D1...');

  const [caseRow, fileRows, damageRows, lawRefRows] = await Promise.all([
    drizzle
      .select({
        plaintiff: cases.plaintiff,
        defendant: cases.defendant,
        case_number: cases.case_number,
        court: cases.court,
        client_role: cases.client_role,
        case_instructions: cases.case_instructions,
        timeline: cases.timeline,
      })
      .from(cases)
      .where(eq(cases.id, CASE_ID))
      .then((rows) => rows[0]),
    drizzle
      .select({
        id: files.id,
        filename: files.filename,
        category: files.category,
        summary: files.summary,
      })
      .from(files)
      .where(eq(files.case_id, CASE_ID)),
    drizzle
      .select({
        category: damagesTable.category,
        description: damagesTable.description,
        amount: damagesTable.amount,
      })
      .from(damagesTable)
      .where(eq(damagesTable.case_id, CASE_ID)),
    readLawRefs(drizzle, CASE_ID),
  ]);

  if (!caseRow) {
    console.error(`Case ${CASE_ID} not found`);
    await proxy.dispose();
    process.exit(1);
  }

  const timeline = parseJsonField<TimelineItem[]>(caseRow.timeline, []);
  const parsedFiles = fileRows.map((f) => {
    const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
    return {
      id: f.id,
      filename: f.filename,
      category: f.category,
      parsedSummary: (summary.summary as string) || null,
    };
  });

  // Build caseSummary from file summaries
  const caseSummary = parsedFiles
    .map((f) => `${f.filename}: ${f.parsedSummary || ''}`)
    .join('\n');

  console.log(`  files: ${parsedFiles.length}`);
  console.log(`  damages: ${damageRows.length}`);
  console.log(`  timeline: ${timeline.length}`);
  console.log(`  lawRefs: ${lawRefRows.length}`);

  // ── Load Step 0 outputs ──
  console.log('\nLoading Step 0 outputs...');
  const modelA = loadStep0Output(MODEL_A_FILE);
  const modelB = loadStep0Output(MODEL_B_FILE);
  console.log(`  ${MODEL_A_LABEL}: ${modelA.legalIssues.length} issues, ${modelA.informationGaps.length} gaps`);
  console.log(`  ${MODEL_B_LABEL}: ${modelB.legalIssues.length} issues, ${modelB.informationGaps.length} gaps`);

  // ── Run pipeline for each model ──

  const runForModel = async (
    label: string,
    step0: { legalIssues: LegalIssue[]; informationGaps: InformationGap[] },
  ): Promise<RunResult> => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Running pipeline for: ${label}`);
    console.log(`${'─'.repeat(60)}`);

    // Step 1: Law Fetch
    console.log('  Step 1: Law Fetch...');
    const step1Start = Date.now();
    const lawFetchResult = await runLawFetch(
      vars.MONGO_URL || '',
      {
        legalIssues: step0.legalIssues,
        userAddedLaws: lawRefRows.filter((r) => r.is_manual),
        existingLawRefs: lawRefRows,
      },
      vars.MONGO_API_KEY,
    );
    const fetchedLawsArray = [...lawFetchResult.laws.values()];
    const step1Elapsed = parseFloat(((Date.now() - step1Start) / 1000).toFixed(1));
    console.log(`  Step 1 done (${step1Elapsed}s) — ${fetchedLawsArray.length} laws`);
    console.log(`    ${fetchedLawsArray.map((l) => `${l.law_name} ${l.article_no}`).join(', ')}`);

    // Construct ContextStore
    const store = new ContextStore();
    store.caseSummary = caseSummary;
    store.parties = {
      plaintiff: caseRow.plaintiff || '',
      defendant: caseRow.defendant || '',
    };
    store.caseMetadata = {
      caseNumber: caseRow.case_number || '',
      court: caseRow.court || '',
      clientRole: caseRow.client_role || '',
      caseInstructions: caseRow.case_instructions || '',
    };
    store.briefType = '準備書狀';
    store.legalIssues = step0.legalIssues;
    store.informationGaps = step0.informationGaps;
    store.damages = damageRows;
    store.timeline = timeline;

    // Construct stub PipelineContext (only AI env needed for Step 2)
    const ctx: PipelineContext = {
      caseId: CASE_ID,
      briefType: '準備書狀',
      title: 'AB Test',
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

    const userAddedLaws = lawRefRows
      .filter((r) => r.is_manual && r.full_text)
      .map((r) => ({
        id: r.id,
        law_name: r.law_name,
        article_no: r.article,
        content: r.full_text!,
      }));

    const strategyInput: ReasoningStrategyInput = {
      caseSummary: store.caseSummary,
      briefType: store.briefType,
      legalIssues: store.legalIssues,
      informationGaps: store.informationGaps,
      fetchedLaws: fetchedLawsArray
        .filter((l) => l.source !== 'user_manual')
        .map(truncateLawContent),
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

    // Step 2: Reasoning + Structuring
    console.log('  Step 2: Reasoning + Structuring...');
    const progress: ReasoningStrategyProgressCallback = {
      onReasoningStart: async () => {
        process.stdout.write('    → 推理中...');
      },
      onSearchLaw: async (query, _purpose, resultCount) => {
        process.stdout.write(`\r    → 補搜: ${query} (${resultCount} 條)`.padEnd(60));
      },
      onFinalized: async () => {
        process.stdout.write('\r    → 推理完成'.padEnd(60) + '\n');
      },
      onOutputStart: async () => {
        process.stdout.write('    → 策略輸出中...\n');
      },
    };

    const step2Start = Date.now();
    const strategyOutput: ReasoningStrategyOutput = await runReasoningStrategy(
      ctx,
      store,
      strategyInput,
      progress,
      null, // no template
    );
    const step2Elapsed = parseFloat(((Date.now() - step2Start) / 1000).toFixed(1));

    // Apply to store
    store.setFoundLaws(fetchedLawsArray);
    store.setStrategyOutput(strategyOutput.claims, strategyOutput.sections);

    // Collect results
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

    console.log(`  Step 2 done (${step2Elapsed}s)`);

    return {
      model: label,
      step1Elapsed,
      step2Elapsed,
      fetchedLawCount: fetchedLawsArray.length,
      supplementedLawCount: store.supplementedLaws.length,
      claims: {
        total: strategyOutput.claims.length,
        ours: ourClaims.length,
        theirs: theirClaims.length,
        rebuttals: rebuttals.length,
        unrebutted: unrebutted.length,
      },
      sections,
      sectionStats: {
        total: strategyOutput.sections.length,
        withLaws: strategyOutput.sections.filter((s) => (s.relevant_law_ids?.length || 0) > 0).length,
        withFiles: strategyOutput.sections.filter((s) => (s.relevant_file_ids?.length || 0) > 0).length,
        totalLawIds: strategyOutput.sections.reduce((sum, s) => sum + (s.relevant_law_ids?.length || 0), 0),
        totalFileIds: strategyOutput.sections.reduce((sum, s) => sum + (s.relevant_file_ids?.length || 0), 0),
      },
    };
  };

  // Run both models sequentially
  const resultA = await runForModel(MODEL_A_LABEL, modelA);
  const resultB = await runForModel(MODEL_B_LABEL, modelB);

  // ── Comparison Output ──

  const pad = (s: unknown, w: number): string => String(s).padStart(w);
  const COL_W = 18;

  console.log(`\n${'═'.repeat(70)}`);
  console.log('Step 2 A/B Comparison');
  console.log(`${'═'.repeat(70)}\n`);

  const header = [pad('Metric', 22), pad(MODEL_A_LABEL, COL_W), pad(MODEL_B_LABEL, COL_W)];
  console.log(header.join(' │ '));
  console.log(['─'.repeat(22), '─'.repeat(COL_W), '─'.repeat(COL_W)].join('─┼─'));

  const metrics: Array<{ label: string; a: unknown; b: unknown }> = [
    { label: 'Step 1 time (s)', a: resultA.step1Elapsed, b: resultB.step1Elapsed },
    { label: 'Step 2 time (s)', a: resultA.step2Elapsed, b: resultB.step2Elapsed },
    { label: 'Fetched laws', a: resultA.fetchedLawCount, b: resultB.fetchedLawCount },
    { label: 'Supplemented laws', a: resultA.supplementedLawCount, b: resultB.supplementedLawCount },
    { label: 'Sections', a: resultA.sectionStats.total, b: resultB.sectionStats.total },
    { label: 'Sections w/ laws', a: resultA.sectionStats.withLaws, b: resultB.sectionStats.withLaws },
    { label: 'Sections w/ files', a: resultA.sectionStats.withFiles, b: resultB.sectionStats.withFiles },
    { label: 'Total law refs', a: resultA.sectionStats.totalLawIds, b: resultB.sectionStats.totalLawIds },
    { label: 'Total file refs', a: resultA.sectionStats.totalFileIds, b: resultB.sectionStats.totalFileIds },
    { label: 'Claims total', a: resultA.claims.total, b: resultB.claims.total },
    { label: 'Claims (ours)', a: resultA.claims.ours, b: resultB.claims.ours },
    { label: 'Claims (theirs)', a: resultA.claims.theirs, b: resultB.claims.theirs },
    { label: 'Rebuttals', a: resultA.claims.rebuttals, b: resultB.claims.rebuttals },
    { label: 'Unrebutted', a: resultA.claims.unrebutted, b: resultB.claims.unrebutted },
  ];

  for (const m of metrics) {
    console.log([pad(m.label, 22), pad(m.a, COL_W), pad(m.b, COL_W)].join(' │ '));
  }

  // Per-section detail
  console.log(`\n${'═'.repeat(70)}`);
  console.log('Per-Section Details');
  console.log(`${'═'.repeat(70)}`);

  for (const result of [resultA, resultB]) {
    console.log(`\n${result.model}:`);
    for (const sec of result.sections) {
      const lawStr = sec.lawCount === 0 ? '! 0' : String(sec.lawCount);
      const dispStr = sec.hasDisputeId ? 'Y' : 'N';
      const subStr = sec.hasSubsection ? 'Y' : '-';
      console.log(
        `  ${sec.key.padEnd(40)} laws=${lawStr.padEnd(4)} files=${String(sec.fileCount).padEnd(3)} claims=${sec.claimCount} disp=${dispStr} sub=${subStr}`,
      );
    }
  }

  console.log('\nDone.');
  await proxy.dispose();
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
