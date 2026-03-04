// ── Test: validateStrategy pure functions ──
// Tests validateStrategyOutput, parseStrategyOutput, applyClaimDefaults.

import {
  validateStrategyOutput,
  parseStrategyOutput,
  applyClaimDefaults,
} from '../../src/server/agent/pipeline/validateStrategy';
import type { Claim, StrategyOutput } from '../../src/server/agent/pipeline/types';
import {
  createTestRunner,
  mkClaim as mkClaimBase,
  mkSection as mkSectionBase,
  mkIssue,
} from './_helpers';

const { assert, summary } = createTestRunner();

console.log('═══ Validation Tests ═══\n');

// ── Local wrappers with validation-friendly defaults ──

const mkClaim = (overrides: Partial<Claim> = {}) =>
  mkClaimBase({
    statement: '測試主張內容，至少三十個字，確保不被截斷',
    assigned_section: 'sec-1',
    dispute_id: 'dispute-1',
    ...overrides,
  });

const mkSection = (overrides: Parameters<typeof mkSectionBase>[0] = {}) =>
  mkSectionBase({
    subsection: '一、侵權行為',
    dispute_id: 'dispute-1',
    argumentation: { legal_basis: ['B0000001-184'], fact_application: '...', conclusion: '...' },
    claims: ['c1'],
    relevant_law_ids: ['B0000001-184'],
    ...overrides,
  });

// ── 1. Valid output passes ──

console.log('── validateStrategyOutput ──');
{
  const output: StrategyOutput = {
    claims: [mkClaim()],
    sections: [mkSection()],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  assert(result.valid === true, 'valid output passes');
  assert(result.errors.length === 0, 'no errors');
}

// ── 2. Duplicate section ID ──
{
  const output: StrategyOutput = {
    claims: [mkClaim()],
    sections: [mkSection({ id: 'sec-1' }), mkSection({ id: 'sec-1' })],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  assert(!result.valid, 'duplicate section ID fails');
  assert(
    result.errors.some((e) => e.includes('重複')),
    'error mentions duplicate',
  );
}

// ── 3. Content section without claims ──
{
  const output: StrategyOutput = {
    claims: [],
    sections: [mkSection({ claims: [] })],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  assert(!result.valid, 'content section without claims fails');
  assert(
    result.errors.some((e) => e.includes('claim')),
    'error mentions claim',
  );
}

// ── 4. Intro/conclusion section without claims is OK ──
{
  const output: StrategyOutput = {
    claims: [mkClaim({ assigned_section: 'sec-body' })],
    sections: [
      mkSection({ id: 'sec-intro', section: '壹、前言', claims: [] }),
      mkSection({ id: 'sec-body', section: '貳、事實及理由', claims: ['c1'] }),
      mkSection({ id: 'sec-end', section: '參、結論', claims: [] }),
    ],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  const claimErrors = result.errors.filter((e) => e.includes('沒有分配任何 claim'));
  assert(claimErrors.length === 0, 'intro/conclusion without claims is OK');
}

// ── 5. Uncovered dispute ──
{
  const output: StrategyOutput = {
    claims: [mkClaim()],
    sections: [mkSection()],
  };
  const issues = [mkIssue({ id: 'dispute-1' }), mkIssue({ id: 'dispute-2', title: '損害' })];
  const result = validateStrategyOutput(output, issues);
  assert(!result.valid, 'uncovered dispute fails');
  assert(
    result.errors.some((e) => e.includes('損害')),
    'error mentions uncovered dispute',
  );
}

// ── 6. Invalid assigned_section ──
{
  const output: StrategyOutput = {
    claims: [mkClaim({ assigned_section: 'nonexistent' })],
    sections: [mkSection()],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  assert(!result.valid, 'invalid assigned_section fails');
  assert(
    result.errors.some((e) => e.includes('不存在的段落')),
    'error mentions invalid section',
  );
}

// ── 7. Ours claim without assigned_section ──
{
  const output: StrategyOutput = {
    claims: [mkClaim({ assigned_section: null })],
    sections: [mkSection({ claims: [] })],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  assert(!result.valid, 'ours claim without assigned_section fails');
  assert(
    result.errors.some((e) => e.includes('未被分配')),
    'error mentions unassigned',
  );
}

// ── 8. Section references nonexistent claim ──
{
  const output: StrategyOutput = {
    claims: [mkClaim({ id: 'c1' })],
    sections: [mkSection({ claims: ['c1', 'c-ghost'] })],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  assert(!result.valid, 'nonexistent claim reference fails');
  assert(
    result.errors.some((e) => e.includes('c-ghost')),
    'error mentions ghost claim',
  );
}

// ── 9. Rebuttal without responds_to ──
{
  const output: StrategyOutput = {
    claims: [mkClaim({ claim_type: 'rebuttal', responds_to: null })],
    sections: [mkSection()],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  assert(!result.valid, 'rebuttal without responds_to fails');
  assert(
    result.errors.some((e) => e.includes('responds_to')),
    'error mentions responds_to',
  );
}

// ── 10. legal_basis not in relevant_law_ids ──
{
  const output: StrategyOutput = {
    claims: [mkClaim()],
    sections: [
      mkSection({
        argumentation: { legal_basis: ['B0000001-999'], fact_application: '', conclusion: '' },
        relevant_law_ids: ['B0000001-184'],
      }),
    ],
  };
  const result = validateStrategyOutput(output, [mkIssue()]);
  assert(!result.valid, 'legal_basis not in relevant_law_ids fails');
  assert(
    result.errors.some((e) => e.includes('B0000001-999')),
    'error mentions missing law',
  );
}

// ── 11. Invalid dispute_id on claim ──
{
  const output: StrategyOutput = {
    claims: [mkClaim({ dispute_id: 'bogus-id' })],
    sections: [mkSection()],
  };
  const result = validateStrategyOutput(output, [mkIssue({ id: 'dispute-1' })]);
  assert(!result.valid, 'invalid dispute_id fails');
  assert(
    result.errors.some((e) => e.includes('bogus-id')),
    'error mentions bogus ID',
  );
}
console.log('');

// ── parseStrategyOutput ──

console.log('── parseStrategyOutput ──');
{
  const json = JSON.stringify({
    claims: [
      { id: 'c1', side: 'ours', statement: '測試', assigned_section: 's1', dispute_id: null },
    ],
    sections: [
      {
        id: 's1',
        section: '前言',
        argumentation: { legal_basis: [], fact_application: '', conclusion: '' },
        claims: ['c1'],
        relevant_file_ids: [],
        relevant_law_ids: [],
      },
    ],
  });

  const parsed = parseStrategyOutput(json);
  assert(parsed.claims.length === 1, 'parsed 1 claim');
  assert(parsed.sections.length === 1, 'parsed 1 section');
  assert(parsed.claims[0].claim_type === 'primary', 'applyClaimDefaults set claim_type');
  assert(parsed.claims[0].responds_to === null, 'applyClaimDefaults set responds_to');
}

// Invalid JSON throws
{
  let threw = false;
  try {
    parseStrategyOutput('not json at all');
  } catch {
    threw = true;
  }
  assert(threw, 'invalid JSON throws');
}

// Missing claims throws
{
  let threw = false;
  try {
    parseStrategyOutput(JSON.stringify({ sections: [] }));
  } catch {
    threw = true;
  }
  assert(threw, 'missing claims throws');
}

// Missing sections throws
{
  let threw = false;
  try {
    parseStrategyOutput(JSON.stringify({ claims: [] }));
  } catch {
    threw = true;
  }
  assert(threw, 'missing sections throws');
}
console.log('');

// ── applyClaimDefaults ──

console.log('── applyClaimDefaults ──');
{
  const claims = applyClaimDefaults([
    { id: 'c1', side: 'ours', statement: '...', assigned_section: 's1' } as Claim,
  ]);
  assert(claims[0].claim_type === 'primary', 'default claim_type is primary');
  assert(claims[0].dispute_id === null, 'default dispute_id is null');
  assert(claims[0].responds_to === null, 'default responds_to is null');
}

// Existing values preserved
{
  const claims = applyClaimDefaults([
    mkClaim({ claim_type: 'rebuttal', dispute_id: 'd1', responds_to: 'c0' }),
  ]);
  assert(claims[0].claim_type === 'rebuttal', 'existing claim_type preserved');
  assert(claims[0].dispute_id === 'd1', 'existing dispute_id preserved');
  assert(claims[0].responds_to === 'c0', 'existing responds_to preserved');
}

summary('✓ All validation tests passed');
