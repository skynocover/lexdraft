// ── Enrichment: fuzzy-match corrupted dispute_ids ──
// Gemini copies 21-char nanoid strings from prompt to output and sometimes
// introduces character-level errors (typos, inserted spaces). Schema validation
// can't catch these — only fuzzy string matching can.

import type { ReasoningStrategyOutput, LegalIssue } from './types';

/**
 * Levenshtein distance between two strings.
 * Used to fuzzy-match corrupted dispute_ids from Gemini output.
 */
export const levenshtein = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

/**
 * Try to find the closest valid issue ID for a corrupted dispute_id.
 * Returns the match if Levenshtein distance ≤ 3 (nanoid is 21 chars, so 3 edits is ~14% error).
 */
export const fuzzyMatchDisputeId = (corrupted: string, validIds: Set<string>): string | null => {
  if (validIds.has(corrupted)) return null; // already valid

  // Strip whitespace that Gemini sometimes inserts
  const stripped = corrupted.replace(/\s/g, '');
  if (validIds.has(stripped)) return stripped;

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const id of validIds) {
    const dist = levenshtein(stripped, id);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = id;
    }
  }
  return bestDist <= 3 ? bestId : null;
};

/** Fix corrupted dispute_ids in an array of items (sections or claims). Returns count of fixes. */
export const fixCorruptedDisputeIds = (
  items: Array<{ dispute_id?: string | null }>,
  validIds: Set<string>,
  label: string,
): number => {
  let fixed = 0;
  for (const item of items) {
    if (item.dispute_id && !validIds.has(item.dispute_id)) {
      const match = fuzzyMatchDisputeId(item.dispute_id, validIds);
      if (match) {
        console.warn(`[enrichment] fixed ${label} dispute_id: "${item.dispute_id}" → "${match}"`);
        item.dispute_id = match;
        fixed++;
      }
    }
  }
  return fixed;
};

/**
 * Post-process Gemini strategy output: fix corrupted dispute_ids via fuzzy matching.
 * Returns the number of IDs fixed.
 */
export const enrichStrategyOutput = (
  output: ReasoningStrategyOutput,
  legalIssues: LegalIssue[] = [],
): number => {
  if (legalIssues.length === 0) return 0;

  const validIds = new Set(legalIssues.map((i) => i.id));
  const fixed =
    fixCorruptedDisputeIds(output.sections, validIds, 'section') +
    fixCorruptedDisputeIds(output.claims, validIds, 'claim');

  if (fixed > 0) {
    console.log(`[enrichment] fixed ${fixed} corrupted dispute_id(s)`);
  }

  return fixed;
};
