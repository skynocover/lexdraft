// ── Snapshot Round-Trip Test ──
// Verifies ContextStore.serialize() → fromSnapshot() preserves all data.

import { ContextStore } from '../../src/server/agent/contextStore';
import type {
  LegalIssue,
  InformationGap,
  DamageItem,
  TimelineItem,
  Claim,
  StrategySection,
  PerIssueAnalysis,
  FetchedLaw,
  FoundLaw,
  DraftSection,
} from '../../src/server/agent/pipeline/types';

let passed = 0;
let failed = 0;

const assert = (condition: boolean, label: string) => {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
};

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ── Build a populated store ──

const store = new ContextStore();

store.caseSummary = '測試案件摘要';
store.parties = { plaintiff: '原告張三', defendant: '被告李四' };
store.caseMetadata = {
  caseNumber: '113年度訴字第123號',
  court: '臺灣臺北地方法院',
  clientRole: 'plaintiff',
  caseInstructions: '請求損害賠償',
};
store.timelineSummary = '2024-01-01 發生車禍';
store.briefType = '準備書狀';

const issue: LegalIssue = {
  id: 'issue-1',
  title: '侵權責任',
  our_position: '被告有過失',
  their_position: '否認過失',
  key_evidence: ['ev-1', 'ev-2'],
  mentioned_laws: ['民法第184條'],
  facts: [
    {
      id: 'fact-1',
      description: '被告闖紅燈',
      assertion_type: '主張',
      source_side: '我方',
      evidence: ['ev-1'],
      disputed_by: null,
    },
  ],
};
store.legalIssues = [issue];

const gap: InformationGap = {
  id: 'gap-1',
  severity: 'critical',
  description: '缺少醫療收據',
  related_issue_id: 'issue-1',
  suggestion: '補充醫療收據',
};
store.informationGaps = [gap];

const damage: DamageItem = {
  category: '醫療費用',
  description: '住院費用',
  amount: 50000,
};
store.damages = [damage];

const timeline: TimelineItem = {
  id: 'tl-1',
  date: '2024-01-01',
  title: '車禍發生',
  description: '被告闖紅燈撞擊原告',
  is_critical: true,
};
store.timeline = [timeline];

const claim: Claim = {
  id: 'claim-1',
  side: 'ours',
  claim_type: 'primary',
  statement: '被告應負損害賠償責任',
  assigned_section: 'sec-1',
  dispute_id: 'issue-1',
  responds_to: null,
};
store.claims = [claim];

const section: StrategySection = {
  id: 'sec-1',
  section: '壹、事實及理由',
  subsection: '一、侵權行為',
  dispute_id: 'issue-1',
  argumentation: {
    legal_basis: ['民法第184條第1項前段'],
    fact_application: '被告闖紅燈',
    conclusion: '故被告應負賠償責任',
  },
  claims: ['claim-1'],
  relevant_file_ids: ['file-1'],
  relevant_law_ids: ['B0000001-184'],
  facts_to_use: [{ fact_id: 'fact-1', assertion_type: '主張', usage: '直接引用' }],
  legal_reasoning: '依民法184條...',
};
store.sections = [section];

store.reasoningSummary = '推理摘要';

const analysis: PerIssueAnalysis = {
  issue_id: 'issue-1',
  chosen_basis: '民法第184條',
  key_law_ids: ['B0000001-184'],
  element_mapping: '要件對應',
  defense_response: '被告抗辯',
};
store.perIssueAnalysis = [analysis];

const supplementedLaw: FetchedLaw = {
  id: 'B0000001-195',
  law_name: '民法',
  article_no: '第 195 條',
  content: '不法侵害他人之身體...',
  source: 'supplemented',
};
store.supplementedLaws = [supplementedLaw];

const foundLaw: FoundLaw = {
  id: 'B0000001-184',
  law_name: '民法',
  article_no: '第 184 條',
  content: '因故意或過失...',
  relevance: '',
  side: 'attack',
};
store.foundLaws = [foundLaw];

const draft: DraftSection = {
  paragraph_id: 'p-1',
  section_id: 'sec-1',
  content: '測試段落內容',
  segments: [{ text: '測試段落內容', citations: [] }],
  citations: [
    {
      id: 'cite-1',
      label: '民法第184條',
      type: 'law',
      quoted_text: '因故意或過失...',
      status: 'confirmed',
    },
  ],
};
store.draftSections = [draft];

// ── Serialize ──

const snapshot = store.serialize();

// ── Restore ──

const restored = ContextStore.fromSnapshot(snapshot);

// ── Compare ──

console.log('── Snapshot Round-Trip Test ──\n');

assert(restored.caseSummary === store.caseSummary, 'caseSummary');
assert(deepEqual(restored.parties, store.parties), 'parties');
assert(deepEqual(restored.caseMetadata, store.caseMetadata), 'caseMetadata');
assert(restored.timelineSummary === store.timelineSummary, 'timelineSummary');
assert(restored.briefType === store.briefType, 'briefType');
assert(deepEqual(restored.legalIssues, store.legalIssues), 'legalIssues');
assert(deepEqual(restored.informationGaps, store.informationGaps), 'informationGaps');
assert(deepEqual(restored.damages, store.damages), 'damages');
assert(deepEqual(restored.timeline, store.timeline), 'timeline');
assert(deepEqual(restored.claims, store.claims), 'claims');
assert(deepEqual(restored.sections, store.sections), 'sections');
assert(restored.reasoningSummary === store.reasoningSummary, 'reasoningSummary');
assert(deepEqual(restored.perIssueAnalysis, store.perIssueAnalysis), 'perIssueAnalysis');
assert(deepEqual(restored.supplementedLaws, store.supplementedLaws), 'supplementedLaws');
assert(deepEqual(restored.foundLaws, store.foundLaws), 'foundLaws');
assert(deepEqual(restored.draftSections, store.draftSections), 'draftSections');

// Verify snapshot version
assert(snapshot._version === 1, '_version === 1');

// Verify JSON round-trip (serialize → JSON.stringify → JSON.parse → fromSnapshot)
const json = JSON.stringify(snapshot);
const parsed = JSON.parse(json);
const restored2 = ContextStore.fromSnapshot(parsed);
assert(deepEqual(restored2.serialize(), snapshot), 'JSON round-trip');

// Verify fromSnapshot with missing fields (backward compat)
const partial = { _version: 1 as const };
const fromPartial = ContextStore.fromSnapshot(partial as never);
assert(fromPartial.caseSummary === '', 'partial → caseSummary defaults to empty');
assert(deepEqual(fromPartial.legalIssues, []), 'partial → legalIssues defaults to []');
assert(deepEqual(fromPartial.foundLaws, []), 'partial → foundLaws defaults to []');

// ── Summary ──

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);
console.log('✓ All snapshot round-trip tests passed');
