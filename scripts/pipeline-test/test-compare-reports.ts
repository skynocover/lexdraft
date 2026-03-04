// ── Test: compare-reports with mock data ──
// Creates two mock replay-step3.json files, runs compare-reports, verifies output.

import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { createTestRunner } from './_helpers';

const { assert, summary } = createTestRunner();

console.log('═══ Compare Reports Tests ═══\n');

const tmpDir = resolve('/tmp/lexdraft-test-compare');
mkdirSync(tmpDir, { recursive: true });

// Mock report A
const reportA = {
  qualityReport: {
    timestamp: '2026-03-04T10:00:00Z',
    totalParagraphs: 6,
    totalLawCites: 8,
    totalFileCites: 20,
    totalCites: 28,
    totalChars: 5000,
    zeroLawContentSections: 2,
    contentSectionCount: 4,
    zeroCiteAllSections: 0,
    allSectionCount: 6,
    perSection: [
      { section: '壹、前言', lawCites: 0, fileCites: 2, charCount: 500 },
      {
        section: '貳、事實及理由',
        subsection: '一、侵權行為',
        disputeId: 'd1',
        lawCites: 3,
        fileCites: 5,
        charCount: 1000,
        lawIds: ['B0000001-184'],
      },
      {
        section: '貳、事實及理由',
        subsection: '二、損害賠償',
        disputeId: 'd2',
        lawCites: 0,
        fileCites: 4,
        charCount: 800,
        lawIds: [],
      },
      {
        section: '貳、事實及理由',
        subsection: '三、精神慰撫金',
        disputeId: 'd3',
        lawCites: 2,
        fileCites: 3,
        charCount: 700,
        lawIds: ['B0000001-195'],
      },
      {
        section: '貳、事實及理由',
        subsection: '四、過失比例',
        disputeId: 'd4',
        lawCites: 0,
        fileCites: 4,
        charCount: 600,
        lawIds: [],
      },
      { section: '參、結論', lawCites: 3, fileCites: 2, charCount: 400 },
    ],
  },
};

// Mock report B (improved)
const reportB = {
  qualityReport: {
    timestamp: '2026-03-04T11:00:00Z',
    totalParagraphs: 6,
    totalLawCites: 14,
    totalFileCites: 25,
    totalCites: 39,
    totalChars: 5500,
    zeroLawContentSections: 0,
    contentSectionCount: 4,
    zeroCiteAllSections: 0,
    allSectionCount: 6,
    perSection: [
      { section: '壹、前言', lawCites: 0, fileCites: 3, charCount: 550 },
      {
        section: '貳、事實及理由',
        subsection: '一、侵權行為',
        disputeId: 'd1',
        lawCites: 4,
        fileCites: 6,
        charCount: 1100,
        lawIds: ['B0000001-184', 'B0000001-185'],
      },
      {
        section: '貳、事實及理由',
        subsection: '二、損害賠償',
        disputeId: 'd2',
        lawCites: 3,
        fileCites: 5,
        charCount: 900,
        lawIds: ['B0000001-196'],
      },
      {
        section: '貳、事實及理由',
        subsection: '三、精神慰撫金',
        disputeId: 'd3',
        lawCites: 3,
        fileCites: 4,
        charCount: 750,
        lawIds: ['B0000001-195'],
      },
      {
        section: '貳、事實及理由',
        subsection: '四、過失比例',
        disputeId: 'd4',
        lawCites: 2,
        fileCites: 5,
        charCount: 700,
        lawIds: ['B0000001-217'],
      },
      { section: '參、結論', lawCites: 2, fileCites: 2, charCount: 500 },
    ],
  },
};

const pathA = `${tmpDir}/report-a.json`;
const pathB = `${tmpDir}/report-b.json`;
writeFileSync(pathA, JSON.stringify(reportA, null, 2));
writeFileSync(pathB, JSON.stringify(reportB, null, 2));

// Test 1: compare-reports runs without error
let output = '';
let exitOk = false;
try {
  output = execSync(`npx tsx scripts/pipeline-test/compare-reports.ts ${pathA} ${pathB}`, {
    encoding: 'utf-8',
    cwd: resolve('.'),
  });
  exitOk = true;
} catch (err) {
  output = (err as { stdout?: string }).stdout || '';
}
assert(exitOk, 'compare-reports exits without error');

// Test 2: output contains comparison header
assert(output.includes('Quality Report Comparison'), 'output has comparison header');

// Test 3: output contains metric names
assert(output.includes('Law cites'), 'output includes Law cites metric');
assert(output.includes('File cites'), 'output includes File cites metric');
assert(output.includes('Total cites'), 'output includes Total cites metric');

// Test 4: output shows positive diff for law cites (8 → 14 = +6)
assert(output.includes('+6'), 'law cites diff is +6');

// Test 5: output shows per-section detail
assert(output.includes('Per-Section Detail'), 'output has per-section header');

// Test 6: output includes section names
assert(
  output.includes('侵權行為') || output.includes('事實及理由'),
  'output includes section names',
);

// Test 7: output includes timestamps
assert(output.includes('2026-03-04T10:00:00Z'), 'output includes Report A timestamp');
assert(output.includes('2026-03-04T11:00:00Z'), 'output includes Report B timestamp');

// Cleanup
rmSync(tmpDir, { recursive: true });

summary('✓ All compare-reports tests passed');
