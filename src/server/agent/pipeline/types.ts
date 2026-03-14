// ── Pipeline Types ──
// Shared types for the brief writing pipeline

/** Human-readable label for a section, e.g. "壹、前言" or "貳、事實 > 一、事故經過" */
export const getSectionKey = (section: string, subsection?: string) =>
  `${section}${subsection ? ' > ' + subsection : ''}`;

import type { Paragraph, Citation, TextSegment } from '../../../client/stores/useBriefStore';
import type { getDB } from '../../db';
import type { AIEnv } from '../aiClient';
import type { SSEEvent, SimpleFact } from '../../../shared/types';
import type { CaseMetadata } from '../contextStore';
import type { BriefModeValue } from '../../../shared/caseConstants';
import type { PipelineMode } from '../prompts/strategyConstants';

// ── Pipeline Context (shared across all steps) ──

export interface PipelineContext {
  caseId: string;
  templateId: string | null;
  briefMode: BriefModeValue | null;
  pipelineMode: PipelineMode;
  title: string;
  signal: AbortSignal;
  sendSSE: (event: SSEEvent) => Promise<void>;
  db: D1Database;
  drizzle: ReturnType<typeof getDB>;
  aiEnv: AIEnv;
  mongoUrl: string;
  mongoApiKey?: string;
}

// Re-export SimpleFact from shared (single source of truth)
export type { SimpleFact };

// ── Legal Issue (擴展既有 Dispute 格式) ──

export interface LegalIssue {
  id: string;
  title: string;
  our_position: string;
  their_position: string;
  key_evidence: string[];
  mentioned_laws: string[];
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
  templateTitle: string;
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
  dispute_id?: string | null;
}

/** Filter out "總計"/"合計" summary rows — use this everywhere damages are summed */
export const isItemDamage = (d: DamageItem): boolean =>
  !d.description?.includes('總計') && !d.description?.includes('合計');

/** Resolve display label for a damage item (description with category fallback) */
export const getDamageLabel = (d: DamageItem): string => d.description || d.category;

/** Format a damage item as "label：新臺幣X元" */
export const formatDamageAmount = (d: DamageItem): string =>
  `${getDamageLabel(d)}：新臺幣${d.amount.toLocaleString()}元`;

/** A section with a subsection is a content section (not intro/conclusion) */
export const isContentSection = (s: { subsection?: string | null }): boolean => !!s.subsection;

// ── Per-Issue Analysis (Reasoning → Structuring handoff) ──

export interface PerIssueAnalysis {
  issue_id: string;
  chosen_basis: string;
  key_law_ids: string[];
  element_mapping: string;
  defense_response?: string;
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
  disputeIdFixed?: number;
}

// Step 2 input
export interface ReasoningStrategyInput {
  caseSummary: string;
  templateTitle: string;
  legalIssues: LegalIssue[];
  undisputedFacts: SimpleFact[];
  informationGaps: string[];
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
  caseMetadata?: CaseMetadata;
}

// Re-export commonly used types
export type { Paragraph, Citation, TextSegment };
