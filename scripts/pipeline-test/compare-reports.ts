/**
 * Compare two quality reports from replay-step3 outputs.
 *
 * Usage:
 *   npx tsx scripts/pipeline-test/compare-reports.ts \
 *     snapshots/run1/replay-step3.json snapshots/run2/replay-step3.json
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { QualityReport } from '../../src/server/agent/pipeline/qualityReport';

// ── Args ──

const [pathA, pathB] = process.argv.slice(2);
if (!pathA || !pathB) {
  console.error('Usage: npx tsx compare-reports.ts <report-a.json> <report-b.json>');
  process.exit(1);
}

// ── Load ──

const loadReport = (filePath: string): QualityReport => {
  const raw = JSON.parse(readFileSync(resolve(filePath), 'utf-8'));
  const report = raw.qualityReport as QualityReport | undefined;
  if (!report) {
    console.error(`No qualityReport field found in ${filePath}`);
    process.exit(1);
  }
  return report;
};

const a = loadReport(pathA);
const b = loadReport(pathB);

// ── Summary Table ──

console.log('═══ Quality Report Comparison ═══\n');

const pad = (s: unknown, w: number): string => String(s).padStart(w);
const COL_W = 14;

const header = ['Metric', 'Report A', 'Report B', 'Diff'].map((c) => pad(c, COL_W));
console.log(header.join(' │ '));
console.log(header.map(() => '─'.repeat(COL_W)).join('─┼─'));

const metrics: { name: string; key: keyof QualityReport }[] = [
  { name: 'Paragraphs', key: 'totalParagraphs' },
  { name: 'Law cites', key: 'totalLawCites' },
  { name: 'File cites', key: 'totalFileCites' },
  { name: 'Total cites', key: 'totalCites' },
  { name: 'Total chars', key: 'totalChars' },
  { name: '0-law content', key: 'zeroLawContentSections' },
  { name: 'Content secs', key: 'contentSectionCount' },
];

for (const m of metrics) {
  const va = a[m.key] as number;
  const vb = b[m.key] as number;
  const diff = vb - va;
  const diffStr = diff > 0 ? `+${diff}` : diff === 0 ? '=' : String(diff);
  console.log(
    [pad(m.name, COL_W), pad(va, COL_W), pad(vb, COL_W), pad(diffStr, COL_W)].join(' │ '),
  );
}

// ── Per-Section Comparison ──

console.log('\n── Per-Section Detail ──\n');

const maxSections = Math.max(a.perSection.length, b.perSection.length);

const secHeader = ['Section', 'A law', 'B law', 'A file', 'B file'].map((c) => pad(c, COL_W));
console.log(secHeader.join(' │ '));
console.log(secHeader.map(() => '─'.repeat(COL_W)).join('─┼─'));

for (let i = 0; i < maxSections; i++) {
  const sa = a.perSection[i];
  const sb = b.perSection[i];
  const label = (sa || sb)?.subsection
    ? `${(sa || sb)!.section} > ${(sa || sb)!.subsection}`
    : (sa || sb)?.section || `Section ${i}`;
  const truncLabel = label.length > COL_W ? label.slice(0, COL_W - 1) + '…' : label;

  console.log(
    [
      pad(truncLabel, COL_W),
      pad(sa?.lawCites ?? '-', COL_W),
      pad(sb?.lawCites ?? '-', COL_W),
      pad(sa?.fileCites ?? '-', COL_W),
      pad(sb?.fileCites ?? '-', COL_W),
    ].join(' │ '),
  );
}

console.log(`\nReport A: ${a.timestamp}`);
console.log(`Report B: ${b.timestamp}`);
