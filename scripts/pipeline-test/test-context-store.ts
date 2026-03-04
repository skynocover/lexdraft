// ── Test: ContextStore serialize/fromSnapshot round-trip ──
// Verifies that all fields survive serialization and deserialization.

import { ContextStore } from '../../src/server/agent/contextStore';
import type {
  Claim,
  StrategySection,
  LegalIssue,
  FetchedLaw,
  FoundLaw,
  DraftSection,
  PerIssueAnalysis,
} from '../../src/server/agent/pipeline/types';
import { createTestRunner } from './_helpers';

const { assert, summary } = createTestRunner();

console.log('═══ Context Store Tests ═══\n');

// ── Helper data ──

const ISSUE: LegalIssue = {
  id: 'dispute-1',
  title: '侵權行為',
  our_position: '被告有過失',
  their_position: '原告亦有過失',
  key_evidence: ['file-1'],
  mentioned_laws: ['民法第184條'],
  facts: [
    {
      id: 'fact-1',
      description: '被告闖紅燈',
      assertion_type: '主張',
      source_side: '我方',
      evidence: ['file-1'],
      disputed_by: null,
    },
  ],
};

const CLAIM: Claim = {
  id: 'claim-1',
  side: 'ours',
  claim_type: 'primary',
  statement: '被告應負侵權責任',
  assigned_section: 'sec-1',
  dispute_id: 'dispute-1',
  responds_to: null,
};

const SECTION: StrategySection = {
  id: 'sec-1',
  section: '貳、事實及理由',
  subsection: '一、侵權行為',
  dispute_id: 'dispute-1',
  argumentation: {
    legal_basis: ['B0000001-184'],
    fact_application: '被告闖紅燈撞傷原告',
    conclusion: '構成侵權行為',
  },
  claims: ['claim-1'],
  relevant_file_ids: ['file-1'],
  relevant_law_ids: ['B0000001-184'],
};

const FETCHED_LAW: FetchedLaw = {
  id: 'B0000001-184',
  law_name: '民法',
  article_no: '第 184 條',
  content: '因故意或過失...',
  source: 'mentioned',
};

const FOUND_LAW: FoundLaw = {
  id: 'B0000001-184',
  law_name: '民法',
  article_no: '第 184 條',
  content: '因故意或過失...',
  relevance: '',
  side: 'attack',
};

const DRAFT: DraftSection = {
  paragraph_id: 'p-1',
  section_id: 'sec-1',
  content: '被告於某年某月某日...',
  segments: [{ type: 'text', text: '被告於某年某月某日...' }],
  citations: [],
};

const ANALYSIS: PerIssueAnalysis = {
  issue_id: 'dispute-1',
  chosen_basis: '民法§184',
  key_law_ids: ['B0000001-184'],
  element_mapping: '構成要件對應',
};

// ── Test 1: Empty store round-trip ──

console.log('── Empty store round-trip ──');
{
  const store = new ContextStore();
  const snap = store.serialize();
  const restored = ContextStore.fromSnapshot(snap);

  assert(restored.caseSummary === '', 'caseSummary empty');
  assert(restored.briefType === '', 'briefType empty');
  assert(restored.legalIssues.length === 0, 'legalIssues empty');
  assert(restored.claims.length === 0, 'claims empty');
  assert(restored.sections.length === 0, 'sections empty');
  assert(restored.foundLaws.length === 0, 'foundLaws empty');
  assert(restored.draftSections.length === 0, 'draftSections empty');
  assert(restored.perIssueAnalysis.length === 0, 'perIssueAnalysis empty');
  assert(snap._version === 1, '_version is 1');
}
console.log('');

// ── Test 2: Populated store round-trip ──

console.log('── Populated store round-trip ──');
{
  const store = new ContextStore();
  store.caseSummary = '車禍損害賠償案件';
  store.briefType = '準備書狀';
  store.parties = { plaintiff: '王大明', defendant: '李小華' };
  store.caseMetadata = {
    caseNumber: '113年度訴字第123號',
    court: '臺灣臺北地方法院',
    clientRole: 'plaintiff',
    caseInstructions: '主張侵權行為',
  };
  store.timelineSummary = '2025年1月1日發生車禍';
  store.legalIssues = [ISSUE];
  store.informationGaps = [
    {
      id: 'gap-1',
      severity: 'critical',
      description: '缺少醫療收據',
      related_issue_id: 'dispute-1',
      suggestion: '請提供',
    },
  ];
  store.damages = [{ category: '醫療費用', description: '手術費', amount: 50000 }];
  store.timeline = [
    { id: 't1', date: '2025-01-01', title: '車禍', description: '發生車禍', is_critical: true },
  ];
  store.claims = [CLAIM];
  store.sections = [SECTION];
  store.reasoningSummary = '以侵權責任為核心';
  store.perIssueAnalysis = [ANALYSIS];
  store.supplementedLaws = [{ ...FETCHED_LAW, source: 'supplemented' }];
  store.foundLaws = [FOUND_LAW];
  store.draftSections = [DRAFT];

  const snap = store.serialize();
  const restored = ContextStore.fromSnapshot(snap);

  // Verify all fields
  assert(restored.caseSummary === '車禍損害賠償案件', 'caseSummary');
  assert(restored.briefType === '準備書狀', 'briefType');
  assert(restored.parties.plaintiff === '王大明', 'parties.plaintiff');
  assert(restored.parties.defendant === '李小華', 'parties.defendant');
  assert(restored.caseMetadata.caseNumber === '113年度訴字第123號', 'caseMetadata.caseNumber');
  assert(restored.caseMetadata.court === '臺灣臺北地方法院', 'caseMetadata.court');
  assert(restored.caseMetadata.clientRole === 'plaintiff', 'caseMetadata.clientRole');
  assert(restored.timelineSummary === '2025年1月1日發生車禍', 'timelineSummary');

  assert(restored.legalIssues.length === 1, 'legalIssues.length');
  assert(restored.legalIssues[0].id === 'dispute-1', 'legalIssues[0].id');
  assert(restored.legalIssues[0].facts.length === 1, 'legalIssues[0].facts');
  assert(restored.legalIssues[0].mentioned_laws[0] === '民法第184條', 'mentioned_laws');

  assert(restored.informationGaps.length === 1, 'informationGaps');
  assert(restored.damages.length === 1, 'damages');
  assert(restored.damages[0].amount === 50000, 'damages[0].amount');
  assert(restored.timeline.length === 1, 'timeline');

  assert(restored.claims.length === 1, 'claims');
  assert(restored.claims[0].id === 'claim-1', 'claims[0].id');
  assert(restored.claims[0].dispute_id === 'dispute-1', 'claims[0].dispute_id');

  assert(restored.sections.length === 1, 'sections');
  assert(restored.sections[0].subsection === '一、侵權行為', 'sections[0].subsection');
  assert(restored.sections[0].relevant_law_ids[0] === 'B0000001-184', 'relevant_law_ids');
  assert(restored.sections[0].argumentation.legal_basis[0] === 'B0000001-184', 'legal_basis');

  assert(restored.reasoningSummary === '以侵權責任為核心', 'reasoningSummary');
  assert(restored.perIssueAnalysis.length === 1, 'perIssueAnalysis');
  assert(restored.perIssueAnalysis[0].key_law_ids[0] === 'B0000001-184', 'key_law_ids');
  assert(restored.supplementedLaws.length === 1, 'supplementedLaws');
  assert(restored.foundLaws.length === 1, 'foundLaws');
  assert(restored.foundLaws[0].law_name === '民法', 'foundLaws[0].law_name');
  assert(restored.draftSections.length === 1, 'draftSections');
  assert(restored.draftSections[0].content === '被告於某年某月某日...', 'draftSections content');
}
console.log('');

// ── Test 3: Partial snapshot (missing fields use defaults) ──

console.log('── Partial snapshot (graceful defaults) ──');
{
  const partial = { _version: 1 as const, caseSummary: '部分資料' } as Parameters<
    typeof ContextStore.fromSnapshot
  >[0];
  const restored = ContextStore.fromSnapshot(partial);
  assert(restored.caseSummary === '部分資料', 'caseSummary set');
  assert(restored.briefType === '', 'briefType defaults to empty');
  assert(restored.legalIssues.length === 0, 'legalIssues defaults to []');
  assert(restored.claims.length === 0, 'claims defaults to []');
}
console.log('');

// ── Test 4: getUnrebutted ──

console.log('── getUnrebutted ──');
{
  const store = new ContextStore();
  store.claims = [
    {
      id: 'theirs-1',
      side: 'theirs',
      claim_type: 'primary',
      statement: '對方主張',
      assigned_section: null,
      dispute_id: null,
      responds_to: null,
    },
    {
      id: 'theirs-2',
      side: 'theirs',
      claim_type: 'primary',
      statement: '對方主張2',
      assigned_section: null,
      dispute_id: null,
      responds_to: null,
    },
    {
      id: 'ours-1',
      side: 'ours',
      claim_type: 'rebuttal',
      statement: '我方反駁',
      assigned_section: 'sec-1',
      dispute_id: null,
      responds_to: 'theirs-1',
    },
  ];

  const unrebutted = store.getUnrebutted();
  assert(unrebutted.length === 1, `1 unrebutted (got ${unrebutted.length})`);
  assert(unrebutted[0].id === 'theirs-2', 'theirs-2 is unrebutted');
}
console.log('');

// ── Test 5: setFoundLaws deduplication ──

console.log('── setFoundLaws deduplication ──');
{
  const store = new ContextStore();
  store.supplementedLaws = [
    {
      id: 'B0000001-184',
      law_name: '民法',
      article_no: '第 184 條',
      content: '...',
      source: 'supplemented',
    },
  ];
  const fetched: FetchedLaw[] = [
    {
      id: 'B0000001-184',
      law_name: '民法',
      article_no: '第 184 條',
      content: '...',
      source: 'mentioned',
    },
    {
      id: 'B0000001-195',
      law_name: '民法',
      article_no: '第 195 條',
      content: '...',
      source: 'mentioned',
    },
  ];
  store.setFoundLaws(fetched);
  assert(store.foundLaws.length === 2, `deduplicated to 2 (got ${store.foundLaws.length})`);
}
console.log('');

// ── Test 6: addSupplementedLaws deduplication ──

console.log('── addSupplementedLaws deduplication ──');
{
  const store = new ContextStore();
  store.addSupplementedLaws([FETCHED_LAW]);
  store.addSupplementedLaws([FETCHED_LAW]); // duplicate
  assert(
    store.supplementedLaws.length === 1,
    `no duplicates (got ${store.supplementedLaws.length})`,
  );
}
console.log('');

// ── Test 7: getContextForSection ──

console.log('── getContextForSection ──');
{
  const store = new ContextStore();
  store.caseSummary = '車禍案';
  store.briefType = '準備書狀';
  store.claims = [CLAIM];
  store.sections = [SECTION];
  store.foundLaws = [FOUND_LAW];
  store.perIssueAnalysis = [ANALYSIS];

  const ctx = store.getContextForSection(0);
  assert(ctx.caseSummary === '車禍案', 'caseSummary');
  assert(ctx.briefType === '準備書狀', 'briefType');
  assert(ctx.claims.length === 1, 'filtered claims');
  assert(ctx.laws.length === 1, 'resolved laws');
  assert(ctx.fullOutline.length === 1, 'fullOutline');
  assert(ctx.fullOutline[0].isCurrent === true, 'isCurrent=true for index 0');
  assert(ctx.completedSections.length === 0, 'no completed sections');
}
console.log('');

// ── Test 8: getContextForSection out of range ──

console.log('── getContextForSection out of range ──');
{
  const store = new ContextStore();
  let threw = false;
  try {
    store.getContextForSection(0);
  } catch {
    threw = true;
  }
  assert(threw, 'throws on out of range');
}

summary('✓ All context store tests passed');
