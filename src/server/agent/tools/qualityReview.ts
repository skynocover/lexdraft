import { eq } from 'drizzle-orm';
import { briefs, disputes } from '../../db/schema';
import { callClaude } from '../claudeClient';
import { runStructuralPreCheck } from '../pipeline/structuralPreCheck';
import { parseLLMJsonResponse, mapDisputeToLegalIssue } from '../toolHelpers';
import { DEFAULT_BRIEF_LABEL } from '../../../shared/caseConstants';
import {
  QUALITY_REVIEWER_SYSTEM_PROMPT,
  buildQualityReviewInput,
} from '../prompts/qualityReviewerPrompt';
import type {
  Claim,
  StrategySection,
  LegalIssue,
  DraftSection,
  ReviewResult,
} from '../pipeline/types';
import type { ToolHandler } from './types';
import type { Paragraph } from '../../../client/stores/useBriefStore';

export const handleQualityReview: ToolHandler = async (_args, caseId, _db, drizzle, ctx) => {
  if (!ctx) {
    return { result: 'Error: missing execution context', success: false };
  }

  // 1. Find the latest brief for this case
  const briefRows = await drizzle
    .select()
    .from(briefs)
    .where(eq(briefs.case_id, caseId))
    .orderBy(briefs.updated_at);

  if (!briefRows.length) {
    return { result: '此案件尚未建立書狀，請先撰寫書狀後再進行品質審查。', success: false };
  }

  const brief = briefRows[briefRows.length - 1]; // latest

  // 2. Parse brief content
  const structured =
    typeof brief.content_structured === 'string'
      ? (JSON.parse(brief.content_structured) as { paragraphs: Paragraph[] })
      : (brief.content_structured as { paragraphs: Paragraph[] } | null);

  const paragraphs = structured?.paragraphs || [];
  if (!paragraphs.length) {
    return { result: '書狀內容為空，請先撰寫書狀後再進行品質審查。', success: false };
  }

  // 3. Load disputes as legal issues
  const disputeRows = await drizzle.select().from(disputes).where(eq(disputes.case_id, caseId));

  const legalIssues: LegalIssue[] = disputeRows.map(mapDisputeToLegalIssue);

  // 4. Build full draft text from paragraphs
  const fullDraft = paragraphs
    .map((p) => {
      const heading = p.subsection ? `${p.section}\n${p.subsection}` : p.section;
      return `${heading}\n\n${p.content_md}`;
    })
    .join('\n\n---\n\n');

  // 5. Build draft sections for structural pre-check (best-effort)
  const draftSections: DraftSection[] = paragraphs.map((p) => ({
    paragraph_id: p.id,
    section_id: p.id, // no strategy section ID available outside pipeline
    content: p.content_md,
    segments: p.segments || [],
    citations: p.citations || [],
  }));

  // 6a. Structural pre-check (pure program — free)
  // Without pipeline context, we pass empty claims/sections for basic checks
  const claims: Claim[] = [];
  const sections: StrategySection[] = [];
  const preCheckResult = runStructuralPreCheck(claims, sections, draftSections, legalIssues);
  const structuralIssueDescs = preCheckResult.issues.map((i) => i.description);

  // 6b. LLM quality review
  const reviewInput = buildQualityReviewInput({
    templateTitle: brief.title || DEFAULT_BRIEF_LABEL,
    fullDraft,
    legalIssues: legalIssues.map((i) => ({
      id: i.id,
      title: i.title,
      our_position: i.our_position,
      their_position: i.their_position,
    })),
    claimCount: 0, // no claims context outside pipeline
    structuralIssues: structuralIssueDescs,
  });

  const { content: reviewContent } = await callClaude(
    ctx.aiEnv,
    QUALITY_REVIEWER_SYSTEM_PROMPT,
    reviewInput,
  );

  const reviewResult = parseLLMJsonResponse<ReviewResult>(reviewContent, '品質審查回傳格式不正確');

  // 7. Format result for chat display
  const resultText = formatReviewResult(reviewResult, preCheckResult);
  return { result: resultText, success: true };
};

/** Format review + structural pre-check results into markdown */
const formatReviewResult = (
  review: ReviewResult,
  preCheck: { issues: Array<{ severity: string; description: string }> },
): string => {
  const lines: string[] = [review.passed ? '## 品質審查結果：通過\n' : '## 品質審查結果：未通過\n'];

  const formatIssueGroup = (
    title: string,
    issues: typeof review.issues,
    formatter: (i: (typeof review.issues)[number]) => string,
  ) => {
    if (issues.length === 0) return;
    lines.push(`### ${title}（${issues.length} 項）\n`);
    for (const issue of issues) lines.push(formatter(issue));
    lines.push('');
  };

  formatIssueGroup(
    '重要問題',
    review.issues.filter((i) => i.severity === 'critical'),
    (i) => `- **[${i.type}]** ${i.description}${i.suggestion ? `\n  建議：${i.suggestion}` : ''}`,
  );

  formatIssueGroup(
    '建議改善',
    review.issues.filter((i) => i.severity === 'warning'),
    (i) => `- **[${i.type}]** ${i.description}${i.suggestion ? `\n  建議：${i.suggestion}` : ''}`,
  );

  if (preCheck.issues.length > 0) {
    lines.push(`### 結構檢查（${preCheck.issues.length} 項）\n`);
    for (const issue of preCheck.issues) lines.push(`- [${issue.severity}] ${issue.description}`);
    lines.push('');
  }

  const hasCritical = review.issues.some((i) => i.severity === 'critical');
  const hasWarning = review.issues.some((i) => i.severity === 'warning');
  if (!hasCritical && !hasWarning && preCheck.issues.length === 0) {
    lines.push('未發現任何問題，書狀品質良好。');
  }

  return lines.join('\n');
};
