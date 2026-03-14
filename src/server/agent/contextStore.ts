// ── Context Store ──
// Centralized data store managing inter-step data flow in the brief pipeline.
// Each pipeline step writes its output here; downstream steps query what they need.

import {
  isContentSection,
  type Claim,
  type StrategySection,
  type LegalIssue,
  type SimpleFact,
  type FoundLaw,
  type FetchedLaw,
  type DraftSection,
  type WriterContext,
  type TimelineItem,
  type DamageItem,
  type PerIssueAnalysis,
} from './pipeline/types';
import type { OrchestratorOutput } from './orchestratorAgent';
import { mapDisputeToLegalIssue, type DisputeRow } from './toolHelpers';

/**
 * 3-tier law fallback for a section:
 * 1. relevant_law_ids (from enrichment) → use those
 * 2. perIssueAnalysis.key_law_ids for matching dispute → fallback
 * 3a. dispute_id=null + subsection set (content, e.g. liability) → ALL found laws
 * 3b. dispute_id=null + no subsection (intro/conclusion) → empty array
 * 3c. dispute_id set but not found in perIssueAnalysis → ALL found laws (safety net)
 */
export const resolveLawsForSection = (
  section: { relevant_law_ids: string[]; dispute_id?: string | null; subsection?: string | null },
  allLaws: FoundLaw[],
  perIssueAnalysis: PerIssueAnalysis[],
): FoundLaw[] => {
  // Tier 1: enrichment filled relevant_law_ids
  if (section.relevant_law_ids.length > 0) {
    const idSet = new Set(section.relevant_law_ids);
    return allLaws.filter((l) => idSet.has(l.id));
  }

  // Tier 2: derive from perIssueAnalysis for this dispute
  if (section.dispute_id) {
    const analysis = perIssueAnalysis.find((a) => a.issue_id === section.dispute_id);
    if (analysis?.key_law_ids?.length) {
      const idSet = new Set(analysis.key_law_ids);
      const derived = allLaws.filter((l) => idSet.has(l.id));
      if (derived.length > 0) {
        console.warn(
          `[contextStore] law fallback tier-2: dispute=${section.dispute_id} → ${derived.length} laws`,
        );
        return derived;
      }
    }
  }

  // Tier 3: sections with no dispute_id and no relevant_law_ids
  // If section has subsection, it's a content section (e.g. liability) → give ALL laws
  // If section has no subsection, it's truly intro/conclusion → no laws
  if (!section.dispute_id) {
    if (isContentSection(section)) {
      console.log(
        `[contextStore] law tier-3: dispute=null but has subsection → ALL ${allLaws.length} laws`,
      );
      return allLaws;
    }
    console.log(`[contextStore] law tier-3: dispute=null (intro/conclusion) → 0 laws`);
    return [];
  }
  console.warn(
    `[contextStore] law fallback tier-3: dispute=${section.dispute_id} → ALL ${allLaws.length} laws`,
  );
  return allLaws;
};

import type { ClientRole } from '../../shared/caseConstants';

export type { ClientRole };

export interface CaseMetadata {
  caseNumber: string;
  court: string;
  division: string;
  clientRole: ClientRole | '';
  caseInstructions: string;
}

export class ContextStore {
  // Step 1: Orchestrator 產出 (Phase 3 — currently seeded from existing data)
  caseSummary = '';
  parties: { plaintiff: string; defendant: string } = { plaintiff: '', defendant: '' };
  caseMetadata: CaseMetadata = {
    caseNumber: '',
    court: '',
    division: '',
    clientRole: '',
    caseInstructions: '',
  };
  templateTitle = '';
  legalIssues: LegalIssue[] = [];
  undisputedFacts: SimpleFact[] = [];
  informationGaps: string[] = [];
  damages: DamageItem[] = [];
  timeline: TimelineItem[] = [];

  // Step 2: 論證策略 Step 產出
  claims: Claim[] = [];
  sections: StrategySection[] = [];

  // Step 2: Reasoning → Structuring 產出
  reasoningSummary = '';
  perIssueAnalysis: PerIssueAnalysis[] = [];
  supplementedLaws: FetchedLaw[] = [];
  foundLaws: FoundLaw[] = []; // combined laws for Writer

  // Step 3: Writer 逐段產出
  draftSections: DraftSection[] = [];

  // Cache for getContextForSection (invalidated by setStrategyOutput/setFoundLaws).
  // NOTE: addDraftSection does NOT invalidate — safe only because the pipeline
  // calls getContextForSection(i) exactly once per index, in ascending order.
  private writerContextCache = new Map<number, WriterContext>();

  // ── Query Methods ──

  /** Get theirs claims that have no ours responds_to */
  getUnrebutted = (): Claim[] => {
    const respondedIds = new Set(
      this.claims.filter((c) => c.side === 'ours' && c.responds_to).map((c) => c.responds_to),
    );
    return this.claims.filter(
      (c) =>
        c.side === 'theirs' &&
        (c.claim_type === 'primary' || c.claim_type === 'rebuttal') &&
        !respondedIds.has(c.id),
    );
  };

  /** Assemble complete Writer context for a specific section (cached per index) */
  getContextForSection = (sectionIndex: number): WriterContext => {
    const cached = this.writerContextCache.get(sectionIndex);
    if (cached) return cached;

    const section = this.sections[sectionIndex];
    if (!section) {
      throw new Error(`Section index ${sectionIndex} out of range`);
    }

    const laws = resolveLawsForSection(section, this.foundLaws, this.perIssueAnalysis);

    const ctx: WriterContext = {
      // 背景層
      caseSummary: this.caseSummary,
      templateTitle: this.templateTitle,
      fullOutline: this.sections.map((s, i) => ({
        section: s.section,
        subsection: s.subsection,
        isCurrent: i === sectionIndex,
      })),
      currentSectionIndex: sectionIndex,

      // 焦點層 — only what this section needs
      claims: this.claims.filter((c) => c.assigned_section === section.id),
      argumentation: section.argumentation,
      laws,
      fileIds: section.relevant_file_ids,
      factsToUse: section.facts_to_use,
      legal_reasoning: section.legal_reasoning,

      // 回顧層 — full text of completed sections
      completedSections: this.draftSections.slice(0, sectionIndex),
    };

    this.writerContextCache.set(sectionIndex, ctx);
    return ctx;
  };

  // ── Mutation Methods (called by pipeline steps) ──

  /** Seed from existing disputes (backward compatible) */
  seedFromDisputes = (disputeList: DisputeRow[]) => {
    this.legalIssues = disputeList.map(mapDisputeToLegalIssue);
  };

  /** Seed from Orchestrator Agent output (Phase 3a) */
  seedFromOrchestrator = (output: OrchestratorOutput) => {
    this.caseSummary = output.caseSummary;
    this.parties = output.parties;
    this.legalIssues = output.legalIssues;
    this.undisputedFacts = output.undisputedFacts;
    this.informationGaps = output.informationGaps;
  };

  /** Set strategy output */
  setStrategyOutput = (claims: Claim[], sections: StrategySection[]) => {
    this.claims = claims;
    this.sections = sections;
    this.writerContextCache.clear();
  };

  /** Add a completed draft section */
  addDraftSection = (draft: DraftSection) => {
    this.draftSections.push(draft);
  };

  /** Set reasoning summary from finalize_strategy tool call */
  setReasoningSummary = (summary: string) => {
    this.reasoningSummary = summary;
  };

  /** Set per-issue analysis from finalize_strategy tool call */
  setPerIssueAnalysis = (analysis: PerIssueAnalysis[]) => {
    this.perIssueAnalysis = analysis;
  };

  /** Add supplemented laws found during Step 2 reasoning (written immediately) */
  addSupplementedLaws = (laws: FetchedLaw[]) => {
    for (const law of laws) {
      if (!this.supplementedLaws.some((l) => l.id === law.id)) {
        this.supplementedLaws.push(law);
      }
    }
  };

  /** Populate foundLaws from fetchedLaws + supplementedLaws (called after Steps 1+2). Clears writer context cache. */
  setFoundLaws = (fetchedLaws: FetchedLaw[]) => {
    this.writerContextCache.clear();
    const allLaws = [...fetchedLaws, ...this.supplementedLaws];
    const seen = new Set<string>();
    this.foundLaws = [];
    for (const law of allLaws) {
      if (seen.has(law.id)) continue;
      seen.add(law.id);
      this.foundLaws.push({
        id: law.id,
        law_name: law.law_name,
        article_no: law.article_no,
        content: law.content,
        relevance: '',
        side: 'attack',
      });
    }
  };

  // ── Serialization ──

  serialize = (): ContextStoreSnapshot => ({
    _version: 1,
    caseSummary: this.caseSummary,
    parties: { ...this.parties },
    caseMetadata: { ...this.caseMetadata },
    templateTitle: this.templateTitle,
    legalIssues: this.legalIssues,
    undisputedFacts: this.undisputedFacts,
    informationGaps: this.informationGaps,
    damages: this.damages,
    timeline: this.timeline,
    claims: this.claims,
    sections: this.sections,
    reasoningSummary: this.reasoningSummary,
    perIssueAnalysis: this.perIssueAnalysis,
    supplementedLaws: this.supplementedLaws,
    foundLaws: this.foundLaws,
    draftSections: this.draftSections,
  });

  static fromSnapshot = (snap: ContextStoreSnapshot): ContextStore => {
    const store = new ContextStore();
    store.caseSummary = snap.caseSummary ?? '';
    store.parties = snap.parties ?? { plaintiff: '', defendant: '' };
    store.caseMetadata = snap.caseMetadata ?? {
      caseNumber: '',
      court: '',
      division: '',
      clientRole: '',
      caseInstructions: '',
    };
    store.templateTitle = snap.templateTitle ?? '';
    store.legalIssues = snap.legalIssues ?? [];
    store.undisputedFacts = snap.undisputedFacts ?? [];
    store.informationGaps = snap.informationGaps ?? [];
    store.damages = snap.damages ?? [];
    store.timeline = snap.timeline ?? [];
    store.claims = snap.claims ?? [];
    store.sections = snap.sections ?? [];
    store.reasoningSummary = snap.reasoningSummary ?? '';
    store.perIssueAnalysis = snap.perIssueAnalysis ?? [];
    store.supplementedLaws = snap.supplementedLaws ?? [];
    store.foundLaws = snap.foundLaws ?? [];
    store.draftSections = snap.draftSections ?? [];
    return store;
  };
}

// ── Snapshot Type ──

export interface ContextStoreSnapshot {
  _version: 1;
  caseSummary: string;
  parties: { plaintiff: string; defendant: string };
  caseMetadata: CaseMetadata;
  templateTitle: string;
  legalIssues: LegalIssue[];
  undisputedFacts: SimpleFact[];
  informationGaps: string[];
  damages: DamageItem[];
  timeline: TimelineItem[];
  claims: Claim[];
  sections: StrategySection[];
  reasoningSummary: string;
  perIssueAnalysis: PerIssueAnalysis[];
  supplementedLaws: FetchedLaw[];
  foundLaws: FoundLaw[];
  draftSections: DraftSection[];
}
