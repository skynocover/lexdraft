/**
 * Layer 2: Pipeline Integration Benchmark
 *
 * Triggers the brief writing pipeline N times on a test case,
 * then queries D1 for citation statistics and outputs a comparison table.
 *
 * Usage:
 *   node scripts/pipeline-test/pipeline-benchmark.mjs [--runs 3] [--case-id XXX]
 *
 * Prerequisites:
 *   - Dev server running on localhost:5173 (`npm run dev`)
 *   - Local D1 database with test case data
 *
 * Env: AUTH_TOKEN loaded from dist/lexdraft/.dev.vars
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ══════════════════════════════════════════════════════════
//  Config
// ══════════════════════════════════════════════════════════

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const NUM_RUNS = parseInt(getArg('--runs', '3'), 10);
const CASE_ID = getArg('--case-id', 'z4keVNfyuKvL68Xg1qPl2');
const BASE_URL = getArg('--url', 'http://localhost:5173');
const CHAT_MESSAGE = '請幫我撰寫書狀';

// Load auth token
const loadAuthToken = () => {
  try {
    const devVars = readFileSync(resolve('dist/lexdraft/.dev.vars'), 'utf-8');
    const m = devVars.match(/AUTH_TOKEN\s*=\s*"?([^\s"]+)"?/);
    return m?.[1] || 'dev-token-change-me';
  } catch {
    return 'dev-token-change-me';
  }
};

const AUTH_TOKEN = loadAuthToken();

// ══════════════════════════════════════════════════════════
//  D1 Helpers
// ══════════════════════════════════════════════════════════

const d1Query = (sql) => {
  const raw = execSync(
    `npx wrangler d1 execute lexdraft-db --local --command "${sql.replace(/"/g, '\\"')}" --json 2>/dev/null`,
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 },
  );
  const parsed = JSON.parse(raw);
  return parsed[0]?.results || [];
};

// ══════════════════════════════════════════════════════════
//  SSE Pipeline Runner
// ══════════════════════════════════════════════════════════

const runPipeline = async (runIndex) => {
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
    body: JSON.stringify({ message: CHAT_MESSAGE }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText.slice(0, 300)}`);
  }

  // Parse SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let briefId = null;
  let sseEvents = [];
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
        const event = JSON.parse(jsonStr);
        sseEvents.push(event);

        // Track brief_id from add_paragraph events
        if (event.type === 'brief_update' && event.action === 'add_paragraph' && event.brief_id) {
          briefId = event.brief_id;
        }

        // Show progress
        if (event.type === 'pipeline_progress') {
          const steps = event.steps || [];
          const currentStep = steps.find((s) => s.status === 'running');
          const line = currentStep
            ? `  [${steps.filter((s) => s.status === 'done').length}/${steps.length}] ${currentStep.label}...`
            : `  [${steps.filter((s) => s.status === 'done').length}/${steps.length}] waiting...`;
          if (line !== lastProgressLine) {
            process.stdout.write('\r' + line.padEnd(80));
            lastProgressLine = line;
          }
        }

        // Track brief_update events
        if (event.type === 'brief_update' && event.action === 'add_paragraph') {
          const sec = event.data?.section || '?';
          const sub = event.data?.subsection ? ' > ' + event.data.subsection : '';
          process.stdout.write(`\r  ✓ 段落完成: ${sec}${sub}`.padEnd(80) + '\n');
        }

        // Done
        if (event.type === 'done') {
          process.stdout.write('\r');
        }

        // Error
        if (event.type === 'error') {
          console.error(`\n  ⚠ Pipeline error: ${event.message}`);
        }
      } catch {
        // Ignore malformed SSE
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  完成 (${elapsed}s)`);

  // Find the latest brief for this case
  if (!briefId) {
    const rows = d1Query(
      `SELECT id FROM briefs WHERE case_id = '${CASE_ID}' ORDER BY created_at DESC LIMIT 1`,
    );
    briefId = rows[0]?.id;
  }

  if (!briefId) {
    console.error('  ⚠ No brief found after pipeline!');
    return null;
  }

  console.log(`  Brief ID: ${briefId}`);
  return { briefId, elapsed: parseFloat(elapsed), sseEvents };
};

// ══════════════════════════════════════════════════════════
//  Citation Analysis
// ══════════════════════════════════════════════════════════

const analyzeBrief = (briefId) => {
  const rows = d1Query(`SELECT content_structured, case_id FROM briefs WHERE id = '${briefId}'`);
  if (!rows[0]?.content_structured) return null;

  // Load dispute titles for better labels
  const disputeMap = new Map();
  if (rows[0].case_id) {
    const disputes = d1Query(`SELECT id, title FROM disputes WHERE case_id = '${rows[0].case_id}'`);
    for (const d of disputes) disputeMap.set(d.id, d.title);
  }

  const cs = JSON.parse(rows[0].content_structured);
  const paragraphs = cs.paragraphs || [];

  const sections = paragraphs.map((p, i) => {
    // Use subsection, or dispute title, or index as label
    let label = p.subsection ? `${p.section} > ${p.subsection}` : p.section;
    if (!p.subsection && p.dispute_id && disputeMap.has(p.dispute_id)) {
      label = `${p.section} [${disputeMap.get(p.dispute_id)}]`;
    }
    const lawCites = (p.citations || []).filter((c) => c.type === 'law').length;
    const fileCites = (p.citations || []).filter((c) => c.type === 'file').length;
    const charCount = (p.content_md || '').length;
    return { label, lawCites, fileCites, charCount };
  });

  const totalLaw = sections.reduce((s, sec) => s + sec.lawCites, 0);
  const totalFile = sections.reduce((s, sec) => s + sec.fileCites, 0);
  const totalChars = sections.reduce((s, sec) => s + sec.charCount, 0);

  // "Content sections" = skip first (前言) and last (結論)
  const contentSections = sections.slice(1, -1);
  const zeroLawSections = contentSections.filter((s) => s.lawCites === 0).length;
  const zeroCiteSections = sections.filter((s) => s.lawCites + s.fileCites === 0).length;

  return {
    briefId,
    numParagraphs: paragraphs.length,
    totalLaw,
    totalFile,
    totalCites: totalLaw + totalFile,
    totalChars,
    zeroLawContent: `${zeroLawSections}/${contentSections.length}`,
    zeroCiteAll: `${zeroCiteSections}/${sections.length}`,
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
  console.log('');

  // Check server is up
  try {
    const healthResp = await fetch(`${BASE_URL}/api/cases`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    if (!healthResp.ok) throw new Error(`HTTP ${healthResp.status}`);
    console.log('✓ Dev server is running');
  } catch (err) {
    console.error(`✗ Cannot reach dev server at ${BASE_URL}`);
    console.error('  Please run "npm run dev" first');
    process.exit(1);
  }

  // Get baseline (latest existing brief before runs)
  const baselineBriefs = d1Query(
    `SELECT id FROM briefs WHERE case_id = '${CASE_ID}' ORDER BY created_at DESC LIMIT 1`,
  );
  const baselineId = baselineBriefs[0]?.id;
  const baseline = baselineId ? analyzeBrief(baselineId) : null;

  // Run pipeline N times
  const results = [];
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
      console.error(`\n  ✗ Run ${i + 1} failed: ${err.message}`);
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

  // Header
  const cols = ['Metric'];
  if (baseline) cols.push('Baseline');
  for (let i = 0; i < results.length; i++) cols.push(`Run ${i + 1}`);
  cols.push('Avg');

  const pad = (s, w) => String(s).padStart(w);
  const COL_W = 12;

  console.log(cols.map((c) => pad(c, COL_W)).join(' │ '));
  console.log(cols.map(() => '─'.repeat(COL_W)).join('─┼─'));

  const metrics = [
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

    // Average (numeric metrics only)
    const numericVals = results.map((r) => r[metric.key]).filter((v) => typeof v === 'number');
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
