// ── Test: enrichStrategy pure functions ──
// Tests levenshtein, fuzzyMatchDisputeId, fixCorruptedDisputeIds, enrichStrategyOutput.

import {
  levenshtein,
  fuzzyMatchDisputeId,
  fixCorruptedDisputeIds,
  enrichStrategyOutput,
} from '../../src/server/agent/pipeline/enrichStrategy';
import type {
  ReasoningStrategyOutput,
  PerIssueAnalysis,
  LegalIssue,
} from '../../src/server/agent/pipeline/types';
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

// ── 4. enrichStrategyOutput — dispute_id from claims ──

console.log('── enrichStrategyOutput: section dispute_id from claims ──');
{
  const output: ReasoningStrategyOutput = {
    claims: [mkClaim({ id: 'c1', dispute_id: 'dispute-1', assigned_section: 'sec-1' })],
    sections: [
      mkSection({ id: 'sec-1', claims: ['c1'] }), // no dispute_id
    ],
  };
  enrichStrategyOutput(output, []);
  assert(output.sections[0].dispute_id === 'dispute-1', 'section got dispute_id from its claim');
}
console.log('');

// ── 5. enrichStrategyOutput — claim dispute_id from section ──

console.log('── enrichStrategyOutput: claim dispute_id from section ──');
{
  const output: ReasoningStrategyOutput = {
    claims: [
      mkClaim({ id: 'c1', assigned_section: 'sec-1' }), // no dispute_id
    ],
    sections: [mkSection({ id: 'sec-1', dispute_id: 'dispute-1', claims: ['c1'] })],
  };
  enrichStrategyOutput(output, []);
  assert(output.claims[0].dispute_id === 'dispute-1', 'claim got dispute_id from its section');
}
console.log('');

// ── 6. enrichStrategyOutput — claims consistency ──

console.log('── enrichStrategyOutput: claims consistency ──');
{
  const output: ReasoningStrategyOutput = {
    claims: [mkClaim({ id: 'c1', assigned_section: 'sec-1' })],
    sections: [
      mkSection({ id: 'sec-1', claims: [] }), // claim not listed
    ],
  };
  enrichStrategyOutput(output, []);
  assert(output.sections[0].claims.includes('c1'), 'section.claims now includes c1');
}
console.log('');

// ── 7. enrichStrategyOutput — legal_basis from perIssueAnalysis ──

console.log('── enrichStrategyOutput: legal_basis from perIssueAnalysis ──');
{
  const analysis: PerIssueAnalysis[] = [
    {
      issue_id: 'dispute-1',
      chosen_basis: '民法§184',
      key_law_ids: ['B0000001-184', 'B0000001-191-2'],
      element_mapping: '...',
    },
  ];
  const output: ReasoningStrategyOutput = {
    claims: [],
    sections: [mkSection({ id: 'sec-1', dispute_id: 'dispute-1' })],
  };
  enrichStrategyOutput(output, analysis);
  assert(
    output.sections[0].argumentation.legal_basis.length === 2,
    `legal_basis filled with 2 items (got ${output.sections[0].argumentation.legal_basis.length})`,
  );
  assert(output.sections[0].argumentation.legal_basis.includes('B0000001-184'), 'includes §184');
}
console.log('');

// ── 8. enrichStrategyOutput — relevant_law_ids validation-only (no mutation) ──

console.log('── enrichStrategyOutput: relevant_law_ids validation-only ──');
{
  const analysis: PerIssueAnalysis[] = [
    {
      issue_id: 'dispute-1',
      chosen_basis: '民法§184',
      key_law_ids: ['B0000001-184'],
      element_mapping: '...',
    },
  ];
  const output: ReasoningStrategyOutput = {
    claims: [],
    sections: [
      mkSection({
        id: 'sec-1',
        dispute_id: 'dispute-1',
        relevant_law_ids: ['B0000001-195'], // pre-existing, missing §184
        argumentation: { legal_basis: ['B0000001-184'], fact_application: '', conclusion: '' },
      }),
    ],
  };
  const stats = enrichStrategyOutput(output, analysis);
  const lawIds = output.sections[0].relevant_law_ids;
  assert(lawIds.length === 1, `no mutation — still 1 ID (got ${lawIds.length})`);
  assert(lawIds.includes('B0000001-195'), 'kept pre-existing §195 unchanged');
  assert(stats.lawIds === 1, `stats.lawIds reports 1 missing (got ${stats.lawIds})`);
}
console.log('');

// ── 9. enrichStrategyOutput — subsection validation-only (no mutation) ──

console.log('── enrichStrategyOutput: subsection validation-only ──');
{
  const issues: LegalIssue[] = [
    {
      id: 'dispute-1',
      title: '侵權行為責任',
      our_position: '',
      their_position: '',
      key_evidence: [],
      mentioned_laws: [],
      facts: [],
    },
    {
      id: 'dispute-2',
      title: '損害賠償計算',
      our_position: '',
      their_position: '',
      key_evidence: [],
      mentioned_laws: [],
      facts: [],
    },
  ];
  const output: ReasoningStrategyOutput = {
    claims: [],
    sections: [
      mkSection({ id: 'sec-1', section: '貳、事實及理由', dispute_id: 'dispute-1' }),
      mkSection({ id: 'sec-2', section: '貳、事實及理由', dispute_id: 'dispute-2' }),
    ],
  };
  const stats = enrichStrategyOutput(output, [], issues);
  assert(!output.sections[0].subsection, `no mutation — subsection still empty`);
  assert(stats.subsection === 2, `stats.subsection reports 2 missing (got ${stats.subsection})`);
}
console.log('');

// ── 10. enrichStrategyOutput — subsection already filled → no warning ──

console.log('── enrichStrategyOutput: subsection already filled ──');
{
  const issues: LegalIssue[] = [
    {
      id: 'dispute-1',
      title: '侵權行為責任',
      our_position: '',
      their_position: '',
      key_evidence: [],
      mentioned_laws: [],
      facts: [],
    },
  ];
  const output: ReasoningStrategyOutput = {
    claims: [],
    sections: [
      mkSection({
        id: 'sec-1',
        section: '貳、事實及理由',
        dispute_id: 'dispute-1',
        subsection: '一、侵權行為責任',
      }),
    ],
  };
  const stats = enrichStrategyOutput(output, [], issues);
  assert(output.sections[0].subsection === '一、侵權行為責任', 'subsection preserved');
  assert(stats.subsection === 0, `stats.subsection is 0 (got ${stats.subsection})`);
}
console.log('');

// ── 11. enrichStrategyOutput — corrupted dispute_id fix ──

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
  enrichStrategyOutput(output, [], issues);
  assert(output.sections[0].dispute_id === 'abc123def456ghi78', 'section dispute_id fixed');
  assert(output.claims[0].dispute_id === 'abc123def456ghi78', 'claim dispute_id fixed');
}
console.log('');

// ── 12. enrichStrategyOutput — no mutation when already complete ──

console.log('── enrichStrategyOutput: no unnecessary mutation ──');
{
  const output: ReasoningStrategyOutput = {
    claims: [mkClaim({ id: 'c1', dispute_id: 'dispute-1', assigned_section: 'sec-1' })],
    sections: [
      mkSection({
        id: 'sec-1',
        dispute_id: 'dispute-1',
        subsection: '一、侵權',
        claims: ['c1'],
        relevant_law_ids: ['B0000001-184'],
        argumentation: {
          legal_basis: ['B0000001-184'],
          fact_application: '...',
          conclusion: '...',
        },
      }),
    ],
  };
  enrichStrategyOutput(output, []);
  assert(output.sections[0].relevant_law_ids.length === 1, 'no extra law_ids added');
  assert(output.sections[0].subsection === '一、侵權', 'subsection unchanged');
}

summary('✓ All enrichment tests passed');
