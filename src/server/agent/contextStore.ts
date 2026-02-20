// ── Context Store ──
// Centralized data store managing inter-step data flow in the brief pipeline.
// Each pipeline step writes its output here; downstream steps query what they need.

import type {
  Claim,
  StrategySection,
  LegalIssue,
  InformationGap,
  ResearchResult,
  FoundLaw,
  DraftSection,
  WriterContext,
  FactUsage,
} from './pipeline/types';
import type { OrchestratorOutput } from './orchestratorAgent';

export class ContextStore {
  // Step 1: Orchestrator 產出 (Phase 3 — currently seeded from existing data)
  caseSummary = '';
  parties: { plaintiff: string; defendant: string } = { plaintiff: '', defendant: '' };
  timelineSummary = '';
  briefType = '';
  legalIssues: LegalIssue[] = [];
  informationGaps: InformationGap[] = [];

  // Step 2: 法律研究 Agent 產出 (Phase 2 — currently seeded from law search)
  research: ResearchResult[] = [];

  // Step 3: 論證策略 Step 產出
  claims: Claim[] = [];
  sections: StrategySection[] = [];

  // Step 4: Writer 逐段產出
  draftSections: DraftSection[] = [];

  // ── Query Methods ──

  /** Get all claims for a specific side */
  getAllClaims = (side?: 'ours' | 'theirs'): Claim[] => {
    if (!side) return this.claims;
    return this.claims.filter((c) => c.side === side);
  };

  /** Get claims assigned to a specific section */
  getClaimsForSection = (sectionId: string): Claim[] => {
    return this.claims.filter((c) => c.assigned_section === sectionId);
  };

  /** Get claims linked to a specific dispute */
  getClaimsForDispute = (disputeId: string): Claim[] => {
    return this.claims.filter((c) => c.dispute_id === disputeId);
  };

  /** Get all claims that respond to a given claim ID */
  getResponsesTo = (claimId: string): Claim[] => {
    return this.claims.filter((c) => c.responds_to === claimId);
  };

  /** Get the claim that this claim responds to */
  getRespondedClaim = (claimId: string): Claim | undefined => {
    const claim = this.claims.find((c) => c.id === claimId);
    if (!claim?.responds_to) return undefined;
    return this.claims.find((c) => c.id === claim.responds_to);
  };

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

  /** Get claims grouped by dispute for SSE / frontend */
  getClaimsGroupedByDispute = (): Array<{
    disputeId: string | null;
    disputeTitle: string;
    claims: Claim[];
  }> => {
    const groups = new Map<string | null, Claim[]>();
    for (const claim of this.claims) {
      const key = claim.dispute_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(claim);
    }

    return Array.from(groups.entries()).map(([disputeId, claims]) => {
      const issue = disputeId ? this.legalIssues.find((i) => i.id === disputeId) : null;
      return {
        disputeId,
        disputeTitle: issue?.title || '未分類主張',
        claims,
      };
    });
  };

  /** Get all found laws across all research results */
  getAllFoundLaws = (): FoundLaw[] => {
    return this.research.flatMap((r) => r.found_laws);
  };

  /** Get found laws for specific law IDs */
  getLawsByIds = (lawIds: string[]): FoundLaw[] => {
    const idSet = new Set(lawIds);
    return this.getAllFoundLaws().filter((l) => idSet.has(l.id));
  };

  /** Get research result for a specific issue */
  getResearchForIssue = (issueId: string): ResearchResult | undefined => {
    return this.research.find((r) => r.issue_id === issueId);
  };

  /** Build full outline for Writer's background layer */
  getFullOutline = (currentIndex: number): WriterContext['fullOutline'] => {
    return this.sections.map((s, i) => ({
      section: s.section,
      subsection: s.subsection,
      isCurrent: i === currentIndex,
    }));
  };

  /** Assemble complete Writer context for a specific section */
  getContextForSection = (sectionIndex: number): WriterContext => {
    const section = this.sections[sectionIndex];
    if (!section) {
      throw new Error(`Section index ${sectionIndex} out of range`);
    }

    return {
      // 背景層
      caseSummary: this.caseSummary,
      briefType: this.briefType,
      fullOutline: this.getFullOutline(sectionIndex),
      currentSectionIndex: sectionIndex,

      // 焦點層 — only what this section needs
      claims: this.getClaimsForSection(section.id),
      argumentation: section.argumentation,
      laws: this.getLawsByIds(section.relevant_law_ids),
      fileIds: section.relevant_file_ids,
      factsToUse: section.facts_to_use,

      // 回顧層 — full text of completed sections
      completedSections: this.draftSections.slice(0, sectionIndex),
    };
  };

  /** Assemble context for quality review */
  getContextForReview = () => {
    return {
      fullDraft: this.draftSections.map((d) => d.content).join('\n\n'),
      legalIssues: this.legalIssues,
      allClaims: this.claims,
      allLaws: this.getAllFoundLaws(),
      strategySections: this.sections,
      informationGaps: this.informationGaps,
    };
  };

  // ── Mutation Methods (called by pipeline steps) ──

  /** Seed from existing disputes (backward compatible) */
  seedFromDisputes = (
    disputeList: Array<{
      id: string;
      title: string | null;
      our_position: string | null;
      their_position: string | null;
    }>,
  ) => {
    this.legalIssues = disputeList.map((d) => ({
      id: d.id,
      title: d.title || '未命名爭點',
      our_position: d.our_position || '',
      their_position: d.their_position || '',
      key_evidence: [],
      mentioned_laws: [],
      facts: [],
    }));
  };

  /** Seed from Orchestrator Agent output (Phase 3a) */
  seedFromOrchestrator = (output: OrchestratorOutput) => {
    this.caseSummary = output.caseSummary;
    this.parties = output.parties;
    this.timelineSummary = output.timelineSummary;
    this.legalIssues = output.legalIssues;
    this.informationGaps = output.informationGaps;
  };

  /** Seed research from flat law results (backward compatible with current law search) */
  seedFromLawSearch = (
    sectionLawMap: Map<
      string,
      Array<{ id: string; law_name: string; article_no: string; content: string }>
    >,
  ) => {
    // Deduplicate laws across all sections
    const lawMap = new Map<string, FoundLaw>();
    for (const laws of sectionLawMap.values()) {
      for (const law of laws) {
        if (!lawMap.has(law.id)) {
          lawMap.set(law.id, {
            id: law.id,
            law_name: law.law_name,
            article_no: law.article_no,
            content: law.content,
            relevance: '',
            side: 'attack',
          });
        }
      }
    }
    const allLaws = Array.from(lawMap.values());

    // Create one research result per legal issue with all found laws
    // (Phase 2 will produce proper per-issue research)
    if (this.legalIssues.length > 0) {
      this.research = this.legalIssues.map((issue) => ({
        issue_id: issue.id,
        strength: 'moderate' as const,
        found_laws: allLaws, // all laws available to all issues for now
        analysis: '',
        attack_points: [],
        defense_risks: [],
      }));
    } else {
      // No issues — single research group
      this.research = [
        {
          issue_id: 'general',
          strength: 'moderate',
          found_laws: allLaws,
          analysis: '',
          attack_points: [],
          defense_risks: [],
        },
      ];
    }
  };

  /** Set strategy output */
  setStrategyOutput = (claims: Claim[], sections: StrategySection[]) => {
    this.claims = claims;
    this.sections = sections;
  };

  /** Add a completed draft section */
  addDraftSection = (draft: DraftSection) => {
    this.draftSections.push(draft);
  };
}
