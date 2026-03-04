/**
 * Layer 1: Unit Test — Law Fallback Logic
 *
 * Tests the 3-tier law resolution logic in contextStore.resolveLawsForSection:
 *   Tier 1: relevant_law_ids has values → use those
 *   Tier 2: empty + has dispute_id → derive from perIssueAnalysis.key_law_ids
 *   Tier 3: still empty → fallback to ALL found laws
 *
 * Usage: npx tsx scripts/pipeline-test/test-law-fallback.ts
 */

import { resolveLawsForSection } from '../../src/server/agent/contextStore';
import type { FoundLaw, PerIssueAnalysis } from '../../src/server/agent/pipeline/types';
import { createTestRunner } from './_helpers';

// ── Test Data ──

const ALL_LAWS: FoundLaw[] = [
  {
    id: 'B0000001-184',
    law_name: '民法',
    article_no: '第 184 條',
    content: '侵權行為...',
    relevance: '',
    side: 'attack',
  },
  {
    id: 'B0000001-191-2',
    law_name: '民法',
    article_no: '第 191-2 條',
    content: '動力車輛...',
    relevance: '',
    side: 'attack',
  },
  {
    id: 'B0000001-193',
    law_name: '民法',
    article_no: '第 193 條',
    content: '不法侵害...',
    relevance: '',
    side: 'attack',
  },
  {
    id: 'B0000001-195',
    law_name: '民法',
    article_no: '第 195 條',
    content: '精神慰撫金...',
    relevance: '',
    side: 'attack',
  },
  {
    id: 'B0000001-196',
    law_name: '民法',
    article_no: '第 196 條',
    content: '物之毀損...',
    relevance: '',
    side: 'attack',
  },
  {
    id: 'B0000001-217',
    law_name: '民法',
    article_no: '第 217 條',
    content: '過失相抵...',
    relevance: '',
    side: 'attack',
  },
];

const PER_ISSUE_ANALYSIS: PerIssueAnalysis[] = [
  {
    issue_id: 'dispute-1',
    chosen_basis: '民法§184-1前段 + §191-2',
    key_law_ids: ['B0000001-184', 'B0000001-191-2'],
    element_mapping: '...',
  },
  {
    issue_id: 'dispute-2',
    chosen_basis: '民法§193',
    key_law_ids: ['B0000001-193'],
    element_mapping: '...',
  },
  {
    issue_id: 'dispute-3',
    chosen_basis: '民法§195',
    key_law_ids: ['B0000001-195'],
    element_mapping: '...',
  },
];

// ── Tests ──

const { assert, summary } = createTestRunner();

console.log('═══ Layer 1: Law Fallback Unit Tests ═══\n');

// ── Test 1: Tier 1 — relevant_law_ids has values ──
console.log('Test 1: Tier 1 — relevant_law_ids has values');
{
  const section = {
    relevant_law_ids: ['B0000001-184', 'B0000001-195'],
    dispute_id: 'dispute-1',
  };
  const result = resolveLawsForSection(section, ALL_LAWS, PER_ISSUE_ANALYSIS);
  assert(result.length === 2, `Returns 2 laws (got ${result.length})`);
  assert(
    result[0].id === 'B0000001-184' && result[1].id === 'B0000001-195',
    'Returns correct law IDs',
  );
}
console.log('');

// ── Test 2: Tier 2 — empty relevant_law_ids + has dispute_id ──
console.log('Test 2: Tier 2 — empty relevant_law_ids, fallback to perIssueAnalysis');
{
  const section = {
    relevant_law_ids: [] as string[],
    dispute_id: 'dispute-1',
  };
  const result = resolveLawsForSection(section, ALL_LAWS, PER_ISSUE_ANALYSIS);
  assert(result.length === 2, `Returns 2 laws from perIssueAnalysis (got ${result.length})`);
  assert(result.map((l) => l.id).includes('B0000001-184'), 'Includes §184 from key_law_ids');
  assert(result.map((l) => l.id).includes('B0000001-191-2'), 'Includes §191-2 from key_law_ids');
}
console.log('');

// ── Test 3: Tier 2 — different dispute_id picks different laws ──
console.log('Test 3: Tier 2 — different dispute picks different laws');
{
  const section = {
    relevant_law_ids: [] as string[],
    dispute_id: 'dispute-3',
  };
  const result = resolveLawsForSection(section, ALL_LAWS, PER_ISSUE_ANALYSIS);
  assert(result.length === 1, `Returns 1 law for dispute-3 (got ${result.length})`);
  assert(result[0].id === 'B0000001-195', 'Returns §195 for 精神慰撫金 dispute');
}
console.log('');

// ── Test 4: Tier 3 — no relevant_law_ids + no dispute_id (前言/結論) ──
console.log('Test 4: Tier 3 — no relevant_law_ids, no dispute_id (intro/conclusion)');
{
  const section = {
    relevant_law_ids: [] as string[],
    dispute_id: null,
  };
  const result = resolveLawsForSection(section, ALL_LAWS, PER_ISSUE_ANALYSIS);
  assert(result.length === 0, `Returns 0 laws for intro/conclusion (got ${result.length})`);
}
console.log('');

// ── Test 5: Tier 3 — has dispute_id but no matching perIssueAnalysis ──
console.log('Test 5: Tier 3 — dispute_id with no matching analysis');
{
  const section = {
    relevant_law_ids: [] as string[],
    dispute_id: 'dispute-unknown',
  };
  const result = resolveLawsForSection(section, ALL_LAWS, PER_ISSUE_ANALYSIS);
  assert(result.length === ALL_LAWS.length, `Returns ALL laws (got ${result.length})`);
}
console.log('');

// ── Test 6: Tier 2 — perIssueAnalysis has key_law_ids but none match foundLaws ──
console.log('Test 6: Tier 2 miss → Tier 3 — key_law_ids reference unfound laws');
{
  const analysisWithBadIds: PerIssueAnalysis[] = [
    {
      issue_id: 'dispute-x',
      chosen_basis: '...',
      key_law_ids: ['NONEXISTENT-001', 'NONEXISTENT-002'],
      element_mapping: '...',
    },
  ];
  const section = {
    relevant_law_ids: [] as string[],
    dispute_id: 'dispute-x',
  };
  const result = resolveLawsForSection(section, ALL_LAWS, analysisWithBadIds);
  assert(result.length === ALL_LAWS.length, `Returns ALL laws as fallback (got ${result.length})`);
}
console.log('');

// ── Test 7: Tier 1 — relevant_law_ids with some IDs not in foundLaws ──
console.log('Test 7: Tier 1 — partial match (some IDs not in foundLaws)');
{
  const section = {
    relevant_law_ids: ['B0000001-184', 'NONEXISTENT-001'],
    dispute_id: 'dispute-1',
  };
  const result = resolveLawsForSection(section, ALL_LAWS, PER_ISSUE_ANALYSIS);
  assert(result.length === 1, `Returns only matching laws (got ${result.length})`);
  assert(result[0].id === 'B0000001-184', 'Returns §184 only');
}
console.log('');

summary('✓ All law fallback tests passed');
