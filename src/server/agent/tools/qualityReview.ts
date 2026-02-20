import { eq } from 'drizzle-orm';
import { briefs, disputes } from '../../db/schema';
import { callClaude } from '../claudeClient';
import { runStructuralPreCheck } from '../pipeline/structuralPreCheck';
import { parseLLMJsonResponse } from '../toolHelpers';
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

  const legalIssues: LegalIssue[] = disputeRows.map((d) => ({
    id: d.id,
    title: d.title || '未命名爭點',
    our_position: d.our_position || '',
    their_position: d.their_position || '',
    key_evidence: [],
    mentioned_laws: [],
    facts: [],
  }));

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
    briefType: brief.brief_type || 'preparation',
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
  const criticalIssues = reviewResult.issues.filter((i) => i.severity === 'critical');
  const warningIssues = reviewResult.issues.filter((i) => i.severity === 'warning');

  let resultText = reviewResult.passed
    ? '## 品質審查結果：通過\n\n'
    : '## 品質審查結果：未通過\n\n';

  if (criticalIssues.length > 0) {
    resultText += `### 重要問題（${criticalIssues.length} 項）\n\n`;
    for (const issue of criticalIssues) {
      resultText += `- **[${issue.type}]** ${issue.description}\n`;
      if (issue.suggestion) resultText += `  建議：${issue.suggestion}\n`;
    }
    resultText += '\n';
  }

  if (warningIssues.length > 0) {
    resultText += `### 建議改善（${warningIssues.length} 項）\n\n`;
    for (const issue of warningIssues) {
      resultText += `- **[${issue.type}]** ${issue.description}\n`;
      if (issue.suggestion) resultText += `  建議：${issue.suggestion}\n`;
    }
    resultText += '\n';
  }

  if (preCheckResult.issues.length > 0) {
    resultText += `### 結構檢查（${preCheckResult.issues.length} 項）\n\n`;
    for (const issue of preCheckResult.issues) {
      resultText += `- [${issue.severity}] ${issue.description}\n`;
    }
    resultText += '\n';
  }

  if (!criticalIssues.length && !warningIssues.length && !preCheckResult.issues.length) {
    resultText += '未發現任何問題，書狀品質良好。\n';
  }

  return { result: resultText, success: true };
};
