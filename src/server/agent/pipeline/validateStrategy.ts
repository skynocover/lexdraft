// ── Strategy Output Validation ──
// Program-side structural validation for the strategy step output.
// Catches structural issues before passing to Writer.

import type { StrategyOutput, LegalIssue, Claim } from './types';
import { parseLLMJsonResponse } from '../toolHelpers';

/** Apply defaults for optional claim fields (backward compatible) */
export const applyClaimDefaults = (claims: Claim[]): Claim[] =>
  claims.map((c) => ({
    ...c,
    claim_type: c.claim_type || 'primary',
    dispute_id: c.dispute_id || null,
    responds_to: c.responds_to || null,
  }));

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate strategy output structure.
 * Checks:
 * 1. Every non-intro/conclusion section has at least one claim
 * 2. Every dispute has a corresponding section
 * 3. Every claim's assigned_section points to a valid section
 * 4. Every ours claim has an assigned_section
 * 5. Sections have valid IDs (no duplicates)
 */
export const validateStrategyOutput = (
  output: StrategyOutput,
  legalIssues: LegalIssue[],
): ValidationResult => {
  const errors: string[] = [];

  // Check section IDs are unique
  const sectionIds = new Set<string>();
  for (const section of output.sections) {
    if (sectionIds.has(section.id)) {
      errors.push(`重複的段落 ID: ${section.id}`);
      continue;
    }
    sectionIds.add(section.id);
  }

  // 1. Every non-intro/conclusion section has at least one claim
  const skipKeywords = ['前言', '結論', '結語'];
  for (const section of output.sections) {
    const isSkippable = skipKeywords.some((k) => section.section.includes(k));
    if (!isSkippable && section.claims.length === 0) {
      errors.push(
        `段落「${section.section}${section.subsection ? ' > ' + section.subsection : ''}」沒有分配任何 claim`,
      );
    }
  }

  // 2. Every dispute has a corresponding section
  for (const issue of legalIssues) {
    const covered = output.sections.some((s) => s.dispute_id === issue.id);
    if (!covered) {
      errors.push(`爭點「${issue.title}」沒有對應段落`);
    }
  }

  // 3. Every claim's assigned_section points to a valid section
  for (const claim of output.claims) {
    if (claim.assigned_section && !sectionIds.has(claim.assigned_section)) {
      errors.push(
        `Claim「${claim.statement.slice(0, 30)}...」指向不存在的段落 ${claim.assigned_section}`,
      );
    }
  }

  // 4. Every ours claim has an assigned_section
  for (const claim of output.claims.filter((c) => c.side === 'ours')) {
    if (!claim.assigned_section) {
      errors.push(`我方主張「${claim.statement.slice(0, 30)}...」未被分配到任何段落`);
    }
  }

  // 5. Claims referenced by sections actually exist
  const claimIds = new Set(output.claims.map((c) => c.id));
  for (const section of output.sections) {
    for (const claimId of section.claims) {
      if (!claimIds.has(claimId)) {
        errors.push(`段落「${section.section}」引用不存在的 claim ID: ${claimId}`);
      }
    }
  }

  // 6. Rebuttal claims must have responds_to pointing to a theirs claim
  const claimMap = new Map(output.claims.map((c) => [c.id, c]));
  for (const claim of output.claims) {
    if (claim.claim_type === 'rebuttal' && !claim.responds_to) {
      errors.push(`反駁主張「${claim.statement.slice(0, 30)}...」缺少 responds_to`);
    }
    if (claim.responds_to && !claimMap.has(claim.responds_to)) {
      errors.push(
        `主張「${claim.statement.slice(0, 30)}...」的 responds_to 指向不存在的 claim: ${claim.responds_to}`,
      );
    }
  }

  // 7. Every theirs primary/rebuttal should have an ours responds_to (warning-level, non-blocking)
  const theirsPrimaryOrRebuttal = output.claims.filter(
    (c) => c.side === 'theirs' && (c.claim_type === 'primary' || c.claim_type === 'rebuttal'),
  );
  for (const theirsClaim of theirsPrimaryOrRebuttal) {
    const hasResponse = output.claims.some(
      (c) => c.side === 'ours' && c.responds_to === theirsClaim.id,
    );
    if (!hasResponse) {
      // Warning only — don't block validation
      console.warn(
        `[Strategy Warning] 對方主張「${theirsClaim.statement.slice(0, 40)}...」尚無我方反駁`,
      );
    }
  }

  // 8. dispute_id must be a valid issue ID (if provided)
  const issueIds = new Set(legalIssues.map((i) => i.id));
  for (const claim of output.claims) {
    if (claim.dispute_id && !issueIds.has(claim.dispute_id)) {
      errors.push(
        `主張「${claim.statement.slice(0, 30)}...」的 dispute_id「${claim.dispute_id}」不是有效的爭點 ID`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Parse strategy output from raw LLM response.
 * Extracts JSON from the response text.
 */
export const parseStrategyOutput = (content: string): StrategyOutput => {
  const parsed = parseLLMJsonResponse<StrategyOutput>(content, '論證策略回傳格式不正確');

  if (!parsed.claims || !Array.isArray(parsed.claims)) {
    throw new Error('論證策略回傳格式不正確（缺少 claims 陣列）');
  }

  if (!parsed.sections || !Array.isArray(parsed.sections)) {
    throw new Error('論證策略回傳格式不正確（缺少 sections 陣列）');
  }

  parsed.claims = applyClaimDefaults(parsed.claims);

  return parsed;
};
