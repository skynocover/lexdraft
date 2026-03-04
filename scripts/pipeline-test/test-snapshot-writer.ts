// ── Test: snapshot-writer write + read ──
// Verifies createSnapshotWriter creates directories and writes valid JSON.

import { readFileSync, existsSync, rmSync } from 'fs';
import { createSnapshotWriter } from './snapshot-writer';
import { createTestRunner } from './_helpers';

const { assert, summary } = createTestRunner();

console.log('═══ Snapshot Writer Tests ═══\n');

const tmpDir = '/tmp/lexdraft-test-snapshot-writer';

// Cleanup before test
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });

// Test 1: createSnapshotWriter creates directory
const writer = createSnapshotWriter(tmpDir);
assert(existsSync(tmpDir), 'directory created');

// Test 2: write step0 data
const step0Data = {
  store: { caseSummary: '測試', briefType: '準備書狀' },
  briefId: 'brief-123',
  fileContentMap: [['file-1', { id: 'file-1', filename: 'test.pdf' }]],
};
writer('step0', step0Data);
assert(existsSync(`${tmpDir}/step0.json`), 'step0.json created');

// Test 3: written file is valid JSON
let readBack: Record<string, unknown> | null = null;
try {
  readBack = JSON.parse(readFileSync(`${tmpDir}/step0.json`, 'utf-8'));
} catch {
  /* */
}
assert(readBack !== null, 'step0.json is valid JSON');

// Test 4: content matches
assert((readBack as Record<string, unknown>)?.briefId === 'brief-123', 'briefId matches');

// Test 5: write step1 data
writer('step1', { fetchedLawsArray: [{ id: 'law-1' }] });
assert(existsSync(`${tmpDir}/step1.json`), 'step1.json created');

// Test 6: write step2 data
writer('step2', { strategyOutput: { claims: [], sections: [] } });
assert(existsSync(`${tmpDir}/step2.json`), 'step2.json created');

// Test 7: write step3 data
writer('step3', { paragraphs: [], qualityReport: {} });
assert(existsSync(`${tmpDir}/step3.json`), 'step3.json created');

// Test 8: nested directory creation
const nestedDir = `${tmpDir}/sub/nested`;
if (existsSync(nestedDir)) rmSync(nestedDir, { recursive: true });
const nestedWriter = createSnapshotWriter(nestedDir);
nestedWriter('test', { ok: true });
assert(existsSync(`${nestedDir}/test.json`), 'nested directory + file created');

// Test 9: large data doesn't throw
const bigData = {
  items: Array.from({ length: 1000 }, (_, i) => ({ id: i, text: '法律條文'.repeat(50) })),
};
let bigOk = false;
try {
  writer('big', bigData);
  bigOk = existsSync(`${tmpDir}/big.json`);
} catch {
  /* */
}
assert(bigOk, 'large data write succeeds');

// Cleanup
rmSync(tmpDir, { recursive: true });

summary('✓ All snapshot-writer tests passed');
