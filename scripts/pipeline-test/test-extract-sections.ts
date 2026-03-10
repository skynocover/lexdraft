/**
 * Unit Test — Template Section Parser
 *
 * Tests extractSections() against all 6 default templates.
 * Verifies correct section name extraction and type classification.
 *
 * Usage: npx tsx scripts/pipeline-test/test-extract-sections.ts
 */

import { extractSections, sectionsToPrompt } from '../../src/server/agent/pipeline/templateHelper';
import { DEFAULT_TEMPLATES } from '../../src/server/lib/defaultTemplates';
import { createTestRunner } from './_helpers';

const { assert, summary } = createTestRunner();

// ── Helper ──

const getTemplate = (id: string): string => {
  const t = DEFAULT_TEMPLATES.find((t) => t.id === id);
  if (!t) throw new Error(`Template not found: ${id}`);
  return t.content_md;
};

// ── Test: 一般起訴狀 ──

console.log('\n[一般起訴狀]');
const civil = extractSections(getTemplate('default-civil-complaint'));
assert(civil.length === 3, `段落數 = 3 (got ${civil.length})`);
assert(civil[0].name === '壹、訴之聲明', `[0] name = 壹、訴之聲明`);
assert(civil[0].type === 'fixed', `[0] type = fixed`);
assert(civil[1].name === '貳、事實及理由', `[1] name = 貳、事實及理由`);
assert(civil[1].type === 'ai_planned', `[1] type = ai_planned`);
assert(civil[2].name === '參、證據方法', `[2] name = 參、證據方法`);
assert(civil[2].type === 'system_generated', `[2] type = system_generated`);

// ── Test: 損害賠償起訴狀 ──

console.log('\n[損害賠償起訴狀]');
const damages = extractSections(getTemplate('default-civil-complaint-damages'));
assert(damages.length === 5, `段落數 = 5 (got ${damages.length})`);
assert(damages[0].name === '壹、訴之聲明', `[0] name = 壹、訴之聲明`);
assert(damages[0].type === 'fixed', `[0] type = fixed`);
assert(damages[1].name === '貳、前言', `[1] name = 貳、前言`);
assert(damages[1].type === 'ai_planned', `[1] type = ai_planned`);
assert(damages[2].name === '參、事實及理由', `[2] name = 參、事實及理由`);
assert(damages[2].type === 'ai_planned', `[2] type = ai_planned`);
assert(damages[3].name === '肆、結論', `[3] name = 肆、結論`);
assert(damages[3].type === 'ai_planned', `[3] type = ai_planned`);
assert(damages[4].name === '伍、證據方法', `[4] name = 伍、證據方法`);
assert(damages[4].type === 'system_generated', `[4] type = system_generated`);

// ── Test: 民事答辯狀 ──

console.log('\n[民事答辯狀]');
const defense = extractSections(getTemplate('default-civil-defense'));
assert(defense.length === 5, `段落數 = 5 (got ${defense.length})`);
assert(defense[0].name === '壹、答辯聲明', `[0] name = 壹、答辯聲明`);
assert(defense[0].type === 'fixed', `[0] type = fixed`);
assert(defense[1].name === '貳、前言', `[1] name = 貳、前言`);
assert(defense[1].type === 'ai_planned', `[1] type = ai_planned`);
assert(defense[2].name === '參、事實及理由', `[2] name = 參、事實及理由`);
assert(defense[2].type === 'ai_planned', `[2] type = ai_planned`);
assert(defense[3].name === '肆、結論', `[3] name = 肆、結論`);
assert(defense[3].type === 'ai_planned', `[3] type = ai_planned`);
assert(defense[4].name === '伍、證據方法', `[4] name = 伍、證據方法`);
assert(defense[4].type === 'system_generated', `[4] type = system_generated`);

// ── Test: 民事準備書狀 ──

console.log('\n[民事準備書狀]');
const preparation = extractSections(getTemplate('default-civil-preparation'));
assert(preparation.length === 4, `段落數 = 4 (got ${preparation.length})`);
assert(preparation[0].name === '壹、前言', `[0] name = 壹、前言`);
assert(preparation[0].type === 'ai_planned', `[0] type = ai_planned`);
assert(preparation[1].name === '貳、事實及理由', `[1] name = 貳、事實及理由`);
assert(preparation[1].type === 'ai_planned', `[1] type = ai_planned`);
assert(preparation[2].name === '參、結論', `[2] name = 參、結論`);
assert(preparation[2].type === 'ai_planned', `[2] type = ai_planned`);
assert(preparation[3].name === '肆、證據方法', `[3] name = 肆、證據方法`);
assert(preparation[3].type === 'system_generated', `[3] type = system_generated`);

// ── Test: 民事上訴狀 ──

console.log('\n[民事上訴狀]');
const appeal = extractSections(getTemplate('default-civil-appeal'));
assert(appeal.length === 5, `段落數 = 5 (got ${appeal.length})`);
assert(appeal[0].name === '壹、上訴聲明', `[0] name = 壹、上訴聲明`);
assert(appeal[0].type === 'fixed', `[0] type = fixed`);
assert(appeal[1].name === '貳、前言', `[1] name = 貳、前言`);
assert(appeal[1].type === 'ai_planned', `[1] type = ai_planned`);
assert(appeal[2].name === '參、事實及理由', `[2] name = 參、事實及理由`);
assert(appeal[2].type === 'ai_planned', `[2] type = ai_planned`);
assert(appeal[3].name === '肆、結論', `[3] name = 肆、結論`);
assert(appeal[3].type === 'ai_planned', `[3] type = ai_planned`);
assert(appeal[4].name === '伍、證據方法', `[4] name = 伍、證據方法`);
assert(appeal[4].type === 'system_generated', `[4] type = system_generated`);

// ── Test: 民事聲請強制執行狀 ──

console.log('\n[民事聲請強制執行狀]');
const enforcement = extractSections(getTemplate('default-enforcement'));
assert(enforcement.length === 5, `段落數 = 5 (got ${enforcement.length})`);
assert(enforcement[0].name === '壹、執行名義', `[0] name = 壹、執行名義`);
assert(enforcement[0].type === 'fixed', `[0] type = fixed`);
assert(enforcement[1].name === '貳、請求金額', `[1] name = 貳、請求金額`);
assert(enforcement[1].type === 'fixed', `[1] type = fixed`);
assert(enforcement[2].name === '參、聲請執行標的', `[2] name = 參、聲請執行標的`);
assert(enforcement[2].type === 'fixed', `[2] type = fixed`);
assert(enforcement[3].name === '肆、事實及理由', `[3] name = 肆、事實及理由`);
assert(enforcement[3].type === 'ai_planned', `[3] type = ai_planned`);
assert(enforcement[4].name === '伍、證據方法', `[4] name = 伍、證據方法`);
assert(enforcement[4].type === 'system_generated', `[4] type = system_generated`);

// ── Test: 未知段落預設 ai_planned ──

console.log('\n[未知段落預設]');
const custom = extractSections('## 壹、自訂段落\n\n內容');
assert(custom.length === 1, `段落數 = 1 (got ${custom.length})`);
assert(custom[0].name === '壹、自訂段落', `[0] name = 壹、自訂段落`);
assert(custom[0].type === 'ai_planned', `[0] type = ai_planned`);

// ── Test: sectionsToPrompt ──

console.log('\n[sectionsToPrompt]');
const prompt = sectionsToPrompt(civil);
assert(prompt.includes('壹、訴之聲明 → 固定內容，不需 AI 規劃'), 'fixed 段落標記正確');
assert(prompt.includes('貳、事實及理由 → 需要 AI 規劃'), 'ai_planned 段落標記正確');
assert(
  prompt.includes('參、證據方法 → 系統自動產生，不需 AI 規劃'),
  'system_generated 段落標記正確',
);
assert(prompt.includes('section 名稱必須完全使用上面列出的段落名稱'), '包含命名指令');

// ── Test: 空 template ──

console.log('\n[空 template]');
const empty = extractSections('沒有段落的文字');
assert(empty.length === 0, `段落數 = 0 (got ${empty.length})`);

// ── Summary ──

summary('All extractSections tests passed!');
