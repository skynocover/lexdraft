// ── Test: enrichStrategy pure functions ──
// Tests levenshtein, fuzzyMatchDisputeId, fixCorruptedDisputeIds, enrichStrategyOutput.

import {
  levenshtein,
  fuzzyMatchDisputeId,
  fixCorruptedDisputeIds,
  enrichStrategyOutput,
} from '../../src/server/agent/pipeline/enrichStrategy';
import type { ReasoningStrategyOutput, LegalIssue } from '../../src/server/agent/pipeline/types';
import { createTestRunner, mkClaim, mkSection } from './_helpers';

const { assert, summary } = createTestRunner();

// ── 1. Levenshtein distance ──

console.log('── levenshtein ──');
assert(levenshtein('', '') === 0, 'empty strings → 0');
assert(levenshtein('abc', 'abc') === 0, 'identical → 0');
assert(levenshtein('abc', 'abd') === 1, '1 substitution → 1');
assert(levenshtein('abc', 'ab') === 1, '1 deletion → 1');
assert(levenshtein('abc', 'abcd') === 1, '1 insertion → 1');
assert(levenshtein('kitten', 'sitting') === 3, 'kitten→sitting → 3');
assert(levenshtein('abcdefghij', 'abcdefghij') === 0, 'long identical → 0');
console.log('');

// ── 2. fuzzyMatchDisputeId ──

console.log('── fuzzyMatchDisputeId ──');
{
  const validIds = new Set(['abc123def456ghi78', 'xyz999aaa111bbb22']);

  // Already valid → null
  assert(fuzzyMatchDisputeId('abc123def456ghi78', validIds) === null, 'already valid → null');

  // 1-edit typo → match
  assert(
    fuzzyMatchDisputeId('abc123def456ghi79', validIds) === 'abc123def456ghi78',
    '1-edit typo → match',
  );

  // Whitespace insertion → match after strip
  assert(
    fuzzyMatchDisputeId('abc123 def456ghi78', validIds) === 'abc123def456ghi78',
    'whitespace stripped → match',
  );

  // Too far → null
  assert(fuzzyMatchDisputeId('COMPLETELY_DIFFERENT', validIds) === null, 'too far → null');

  // 3-edit boundary → match
  assert(
    fuzzyMatchDisputeId('abc123def456ghi00', validIds) === 'abc123def456ghi78',
    '2-edit boundary → match',
  );
}
console.log('');

// ── 3. fixCorruptedDisputeIds ──

console.log('── fixCorruptedDisputeIds ──');
{
  const validIds = new Set(['dispute-aaa', 'dispute-bbb']);

  // Fix one corrupted item
  const items = [
    { dispute_id: 'dispute-aab' }, // 1 edit from dispute-aaa
    { dispute_id: 'dispute-bbb' }, // valid
    { dispute_id: null }, // null, skip
  ];
  const fixed = fixCorruptedDisputeIds(items, validIds, 'test');
  assert(fixed === 1, `fixed 1 item (got ${fixed})`);
  assert(items[0].dispute_id === 'dispute-aaa', 'corrupted → corrected');
  assert(items[1].dispute_id === 'dispute-bbb', 'valid unchanged');
  assert(items[2].dispute_id === null, 'null unchanged');
}
console.log('');

// ── 4. enrichStrategyOutput — corrupted dispute_id fix ──

console.log('── enrichStrategyOutput: corrupted dispute_id fix ──');
{
  const issues: LegalIssue[] = [
    {
      id: 'abc123def456ghi78',
      title: '侵權',
      our_position: '',
      their_position: '',
      key_evidence: [],
      mentioned_laws: [],
      facts: [],
    },
  ];
  const output: ReasoningStrategyOutput = {
    claims: [
      mkClaim({ id: 'c1', dispute_id: 'abc123def456ghi79' }), // 1 edit
    ],
    sections: [mkSection({ id: 'sec-1', dispute_id: 'abc123def456ghi79', claims: ['c1'] })],
  };
  const fixed = enrichStrategyOutput(output, issues);
  assert(fixed === 2, `fixed 2 IDs (got ${fixed})`);
  assert(output.sections[0].dispute_id === 'abc123def456ghi78', 'section dispute_id fixed');
  assert(output.claims[0].dispute_id === 'abc123def456ghi78', 'claim dispute_id fixed');
}
console.log('');

// ── 5. enrichStrategyOutput — no issues → no-op ──

console.log('── enrichStrategyOutput: no issues → 0 ──');
{
  const output: ReasoningStrategyOutput = {
    claims: [mkClaim({ id: 'c1', dispute_id: 'whatever' })],
    sections: [mkSection({ id: 'sec-1', dispute_id: 'whatever', claims: ['c1'] })],
  };
  const fixed = enrichStrategyOutput(output, []);
  assert(fixed === 0, `no issues → 0 (got ${fixed})`);
}
console.log('');

// ── 6. enrichStrategyOutput — all valid → 0 ──

console.log('── enrichStrategyOutput: all valid → 0 ──');
{
  const issues: LegalIssue[] = [
    {
      id: 'dispute-1',
      title: '侵權',
      our_position: '',
      their_position: '',
      key_evidence: [],
      mentioned_laws: [],
      facts: [],
    },
  ];
  const output: ReasoningStrategyOutput = {
    claims: [mkClaim({ id: 'c1', dispute_id: 'dispute-1', assigned_section: 'sec-1' })],
    sections: [
      mkSection({
        id: 'sec-1',
        dispute_id: 'dispute-1',
        claims: ['c1'],
        relevant_law_ids: ['B0000001-184'],
      }),
    ],
  };
  const fixed = enrichStrategyOutput(output, issues);
  assert(fixed === 0, `all valid → 0 (got ${fixed})`);
}

summary('✓ All enrichment tests passed');
