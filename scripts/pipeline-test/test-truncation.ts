// ── Test: truncateLawContent pure function ──
// Tests the law content truncation helper from lawFetchStep.

import { truncateLawContent } from '../../src/server/agent/pipeline/lawFetchStep';
import type { FetchedLaw } from '../../src/server/agent/pipeline/types';
import { createTestRunner } from './_helpers';

const { assert, summary } = createTestRunner();

console.log('═══ Truncation Tests ═══\n');

const mkLaw = (content: string): FetchedLaw => ({
  id: 'B0000001-184',
  law_name: '民法',
  article_no: '第 184 條',
  content,
  source: 'mentioned',
});

// ── 1. Short content is not truncated ──

console.log('── truncateLawContent ──');
{
  const law = mkLaw('短內容');
  const result = truncateLawContent(law);
  assert(result.content === '短內容', 'short content unchanged');
  assert(result === law, 'returns same object ref (no copy)');
}

// ── 2. Exactly 600 chars is not truncated ──
{
  const content = '法'.repeat(600);
  const law = mkLaw(content);
  const result = truncateLawContent(law);
  assert(result.content.length === 600, 'exactly 600 chars unchanged');
  assert(result === law, 'returns same object ref');
}

// ── 3. 601 chars gets truncated ──
{
  const content = '法'.repeat(601);
  const law = mkLaw(content);
  const result = truncateLawContent(law);
  assert(result !== law, 'returns new object');
  assert(result.content !== content, 'content is different');
  assert(result.content.endsWith('...（截斷）'), 'ends with truncation marker');
  assert(result.content.startsWith('法'), 'content prefix preserved');
}

// ── 4. Truncated content is exactly 600 + suffix length ──
{
  const content = '法'.repeat(1000);
  const law = mkLaw(content);
  const result = truncateLawContent(law);
  const suffix = '...（截斷）';
  assert(
    result.content.length === 600 + suffix.length,
    `truncated to 600+suffix (got ${result.content.length})`,
  );
}

// ── 5. Other fields preserved after truncation ──
{
  const content = '法'.repeat(800);
  const law = mkLaw(content);
  const result = truncateLawContent(law);
  assert(result.id === 'B0000001-184', 'id preserved');
  assert(result.law_name === '民法', 'law_name preserved');
  assert(result.article_no === '第 184 條', 'article_no preserved');
  assert(result.source === 'mentioned', 'source preserved');
}

// ── 6. Empty content ──
{
  const law = mkLaw('');
  const result = truncateLawContent(law);
  assert(result.content === '', 'empty content unchanged');
}

summary('✓ All truncation tests passed');
