// ── Structural Pre-Check ──
// Pure-program validation of the draft against claims and strategy.
// Runs before the LLM quality reviewer to catch structural issues cheaply.

import type {
  Claim,
  StrategySection,
  LegalIssue,
  DraftSection,
  PreCheckIssue,
  PreCheckResult,
} from './types';

/**
 * Run structural pre-check on the completed draft.
 * Checks:
 * 1. Every "ours" claim is mentioned in at least one draft section
 * 2. Every "theirs" claim has a rebuttal somewhere (at least the section it's in mentions it)
 * 3. Every legal issue has at least one corresponding draft section
 * 4. No draft section is empty
 */
export const runStructuralPreCheck = (
  claims: Claim[],
  sections: StrategySection[],
  draftSections: DraftSection[],
  legalIssues: LegalIssue[],
): PreCheckResult => {
  const issues: PreCheckIssue[] = [];

  const draftBySectionId = new Map<string, DraftSection>();
  for (const draft of draftSections) {
    draftBySectionId.set(draft.section_id, draft);
  }

  // 1. Every "ours" claim should appear in a draft section
  const oursClaims = claims.filter((c) => c.side === 'ours');
  for (const claim of oursClaims) {
    if (!claim.assigned_section) {
      issues.push({
        severity: 'critical',
        type: 'unassigned_claim',
        description: `我方主張「${claim.statement.slice(0, 40)}...」未分配到任何段落`,
      });
      continue;
    }

    const draft = draftBySectionId.get(claim.assigned_section);
    if (!draft || !draft.content.trim()) {
      issues.push({
        severity: 'critical',
        type: 'unassigned_claim',
        description: `我方主張「${claim.statement.slice(0, 40)}...」分配到的段落沒有內容`,
      });
    }
  }

  // 2. Every "theirs" claim should have at least a response
  const theirsClaims = claims.filter((c) => c.side === 'theirs');
  for (const claim of theirsClaims) {
    // Precise check: look for ours claims that responds_to this theirs claim
    const rebuttals = claims.filter((c) => c.side === 'ours' && c.responds_to === claim.id);

    if (rebuttals.length > 0) {
      // Has explicit rebuttal — check that the rebuttal's section has a draft
      const hasDraft = rebuttals.some((r) => {
        if (!r.assigned_section) return false;
        const draft = draftBySectionId.get(r.assigned_section);
        return draft && draft.content.trim().length > 0;
      });
      if (!hasDraft) {
        issues.push({
          severity: 'warning',
          type: 'uncovered_opponent_claim',
          description: `對方主張「${claim.statement.slice(0, 40)}...」的反駁段落未有實質內容`,
        });
      }
      continue;
    }

    // Fallback: section-based check (backward compatible for claims without responds_to)
    const containingSections = sections.filter((s) => s.claims.includes(claim.id));
    if (containingSections.length === 0) {
      issues.push({
        severity: 'warning',
        type: 'uncovered_opponent_claim',
        description: `對方主張「${claim.statement.slice(0, 40)}...」未在任何段落中回應`,
      });
      continue;
    }

    const hasDraft = containingSections.some((s) => {
      const draft = draftBySectionId.get(s.id);
      return draft && draft.content.trim().length > 0;
    });

    if (!hasDraft) {
      issues.push({
        severity: 'warning',
        type: 'uncovered_opponent_claim',
        description: `對方主張「${claim.statement.slice(0, 40)}...」所在段落未有實質回應`,
      });
    }
  }

  // 3. Every legal issue should have a corresponding draft section
  for (const issue of legalIssues) {
    const hasSection = sections.some(
      (s) => s.dispute_id === issue.id && draftBySectionId.has(s.id),
    );
    if (!hasSection) {
      issues.push({
        severity: 'critical',
        type: 'uncovered_dispute',
        description: `爭點「${issue.title}」沒有對應的書狀段落`,
      });
    }
  }

  return { issues };
};
