// ── Context Store ──
// Centralized data store managing inter-step data flow in the brief pipeline.
// Each pipeline step writes its output here; downstream steps query what they need.

import type {
  Claim,
  StrategySection,
  LegalIssue,
  InformationGap,
  FoundLaw,
  FetchedLaw,
  DraftSection,
  WriterContext,
  TimelineItem,
  DamageItem,
  PerIssueAnalysis,
} from './pipeline/types';
import type { OrchestratorOutput } from './orchestratorAgent';

export interface CaseMetadata {
  caseNumber: string;
  court: string;
  caseType: string;
  clientRole: string; // 'plaintiff' | 'defendant' | ''
  caseInstructions: string;
}

export class ContextStore {
  // Step 1: Orchestrator 產出 (Phase 3 — currently seeded from existing data)
  caseSummary = '';
  parties: { plaintiff: string; defendant: string } = { plaintiff: '', defendant: '' };
  caseMetadata: CaseMetadata = {
    caseNumber: '',
    court: '',
    caseType: '',
    clientRole: '',
    caseInstructions: '',
  };
  timelineSummary = '';
  briefType = '';
  legalIssues: LegalIssue[] = [];
  informationGaps: InformationGap[] = [];
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

  /** Get all found laws */
  getAllFoundLaws = (): FoundLaw[] => {
    return this.foundLaws;
  };

  /** Assemble complete Writer context for a specific section */
  getContextForSection = (sectionIndex: number): WriterContext => {
    const section = this.sections[sectionIndex];
    if (!section) {
      throw new Error(`Section index ${sectionIndex} out of range`);
    }

    const lawIdSet = new Set(section.relevant_law_ids);

    return {
      // 背景層
      caseSummary: this.caseSummary,
      briefType: this.briefType,
      fullOutline: this.sections.map((s, i) => ({
        section: s.section,
        subsection: s.subsection,
        isCurrent: i === sectionIndex,
      })),
      currentSectionIndex: sectionIndex,

      // 焦點層 — only what this section needs
      claims: this.claims.filter((c) => c.assigned_section === section.id),
      argumentation: section.argumentation,
      laws: this.getAllFoundLaws().filter((l) => lawIdSet.has(l.id)),
      fileIds: section.relevant_file_ids,
      factsToUse: section.facts_to_use,
      legal_reasoning: section.legal_reasoning,

      // 回顧層 — full text of completed sections
      completedSections: this.draftSections.slice(0, sectionIndex),
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

  /** Set strategy output */
  setStrategyOutput = (claims: Claim[], sections: StrategySection[]) => {
    this.claims = claims;
    this.sections = sections;
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

  /** Populate foundLaws from fetchedLaws + supplementedLaws (called after Steps 1+2) */
  setFoundLaws = (fetchedLaws: FetchedLaw[]) => {
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
}
