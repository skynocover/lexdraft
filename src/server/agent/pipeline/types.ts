// ── Pipeline Types ──
// Shared types for the brief writing pipeline

import type { Paragraph, Citation, TextSegment } from '../../../client/stores/useBriefStore';

// ── Structured Fact (事實爭議分類) ──

export interface StructuredFact {
  id: string;
  description: string;
  assertion_type: '主張' | '承認' | '爭執' | '自認' | '推定';
  source_side: '我方' | '對方' | '中立';
  evidence: string[];
  disputed_by: string | null;
}

// ── Legal Issue (擴展既有 Dispute 格式) ──

export interface LegalIssue {
  id: string;
  title: string;
  our_position: string;
  their_position: string;
  key_evidence: string[];
  mentioned_laws: string[];
  facts: StructuredFact[];
}

// ── Information Gap ──

export interface InformationGap {
  id: string;
  severity: 'critical' | 'nice_to_have';
  description: string;
  related_issue_id: string;
  suggestion: string;
}

// ── Claim (Phase 3b — 攻防配對 + 爭點連結) ──

export type ClaimType = 'primary' | 'rebuttal' | 'supporting';

export interface Claim {
  id: string;
  side: 'ours' | 'theirs';
  claim_type: ClaimType;
  statement: string;
  assigned_section: string | null;
  dispute_id: string | null;
  responds_to: string | null;
}

// ── Strategy Section (論證策略 output) ──

export interface ArgumentationFramework {
  legal_basis: string[];
  fact_application: string;
  conclusion: string;
}

export interface FactUsage {
  fact_id: string;
  assertion_type: string;
  usage: string;
}

export interface StrategySection {
  id: string;
  section: string;
  subsection?: string;
  dispute_id?: string;
  argumentation: ArgumentationFramework;
  claims: string[]; // claim IDs
  relevant_file_ids: string[];
  relevant_law_ids: string[];
  facts_to_use?: FactUsage[];
  legal_reasoning?: string;
}

// ── Strategy Output (論證策略完整 output) ──

export interface StrategyOutput {
  claims: Claim[];
  sections: StrategySection[];
  claim_coverage_check?: {
    uncovered_their_claims: string[];
    note: string;
  };
}

// ── Found Law ──

export interface FoundLaw {
  id: string;
  law_name: string;
  article_no: string;
  content: string;
  relevance: string;
  side: 'attack' | 'defense_risk' | 'reference';
}

// ── Draft Section (Writer output) ──

export interface DraftSection {
  paragraph_id: string;
  section_id: string;
  content: string;
  segments: TextSegment[];
  citations: Citation[];
}

// ── Writer Context (per-section context assembly) ──

export interface WriterContext {
  // 背景層
  caseSummary: string;
  briefType: string;
  fullOutline: { section: string; subsection?: string; isCurrent: boolean }[];
  currentSectionIndex: number;

  // 焦點層
  claims: Claim[];
  argumentation: ArgumentationFramework;
  laws: FoundLaw[];
  fileIds: string[];
  factsToUse?: FactUsage[];
  legal_reasoning?: string; // from ReasoningSection

  // 回顧層
  completedSections: DraftSection[];
}

// ── Pre-check Result (結構化前檢) ──

export interface PreCheckIssue {
  severity: 'critical' | 'warning';
  type: 'unassigned_claim' | 'uncovered_opponent_claim' | 'uncovered_dispute';
  description: string;
}

export interface PreCheckResult {
  issues: PreCheckIssue[];
}

// ── Review Result (品質審查 output) ──

export interface ReviewIssue {
  paragraph_id?: string;
  severity: 'critical' | 'warning';
  type: string;
  description: string;
  suggestion: string;
}

export interface ReviewResult {
  passed: boolean;
  structural_issues_from_precheck: number;
  issues: ReviewIssue[];
}

// ── Timeline Item (時間軸事件) ──

export interface TimelineItem {
  id: string;
  date: string;
  title: string;
  description: string;
  is_critical: boolean;
}

// ── Damage Item (金額項目) ──

export interface DamageItem {
  category: string;
  description: string | null;
  amount: number;
}

// ── Law Fetch Types ──

// Step 1 output (pure function, no AI)
export interface FetchedLaw {
  id: string; // e.g., "B0000001-184" (pcode format, matches DB _id)
  law_name: string; // e.g., "民法"
  article_no: string; // e.g., "第 184 條"
  content: string; // full article text
  source: 'mentioned' | 'user_manual' | 'supplemented';
}

export interface LawFetchResult {
  laws: Map<string, FetchedLaw>; // key = law_id
  total: number;
}

// Step 2 output (Claude tool-loop)
export interface ReasoningSection extends StrategySection {
  legal_reasoning: string; // ≤300 chars free-text reasoning per section
}

export interface ReasoningStrategyOutput {
  claims: Claim[];
  sections: ReasoningSection[];
}

// Step 2 input
export interface ReasoningStrategyInput {
  caseSummary: string;
  briefType: string;
  legalIssues: LegalIssue[];
  informationGaps: InformationGap[];
  fetchedLaws: FetchedLaw[];
  fileSummaries: Array<{
    id: string;
    filename: string;
    category: string | null;
    summary: string;
  }>;
  damages: DamageItem[];
  timeline: TimelineItem[];
  userAddedLaws: Array<{
    id: string;
    law_name: string;
    article_no: string;
    content: string;
  }>;
  caseMetadata?: {
    caseNumber: string;
    court: string;
    caseType: string;
    clientRole: string;
    caseInstructions: string;
  };
}

// Re-export commonly used types
export type { Paragraph, Citation, TextSegment };
