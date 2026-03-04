// ── Quality Report ──
// Pure function: computes citation statistics from Paragraph[].

import type { Paragraph } from '../../../client/stores/useBriefStore';

export interface SectionQuality {
  section: string;
  subsection?: string;
  disputeId: string | null;
  lawCites: number;
  fileCites: number;
  charCount: number;
  lawIds: string[];
}

export interface QualityReport {
  timestamp: string;
  totalParagraphs: number;
  totalLawCites: number;
  totalFileCites: number;
  totalCites: number;
  totalChars: number;
  zeroLawContentSections: number;
  contentSectionCount: number;
  zeroCiteAllSections: number;
  allSectionCount: number;
  perSection: SectionQuality[];
}

export const buildQualityReport = (paragraphs: Paragraph[]): QualityReport => {
  const perSection: SectionQuality[] = paragraphs.map((p) => {
    const lawCitations = (p.citations || []).filter((c) => c.type === 'law');
    const fileCites = (p.citations || []).filter((c) => c.type === 'file').length;
    return {
      section: p.section,
      subsection: p.subsection || undefined,
      disputeId: p.dispute_id ?? null,
      lawCites: lawCitations.length,
      fileCites,
      charCount: (p.content_md || '').length,
      lawIds: lawCitations.map((c) => c.id),
    };
  });

  const totalLawCites = perSection.reduce((s, sec) => s + sec.lawCites, 0);
  const totalFileCites = perSection.reduce((s, sec) => s + sec.fileCites, 0);
  const totalChars = perSection.reduce((s, sec) => s + sec.charCount, 0);

  // Content sections = exclude first (intro) and last (conclusion)
  const contentSections = perSection.length > 2 ? perSection.slice(1, -1) : [];
  const zeroLawContentSections = contentSections.filter((s) => s.lawCites === 0).length;

  const zeroCiteAllSections = perSection.filter((s) => s.lawCites + s.fileCites === 0).length;

  return {
    timestamp: new Date().toISOString(),
    totalParagraphs: paragraphs.length,
    totalLawCites,
    totalFileCites,
    totalCites: totalLawCites + totalFileCites,
    totalChars,
    zeroLawContentSections,
    contentSectionCount: contentSections.length,
    zeroCiteAllSections,
    allSectionCount: perSection.length,
    perSection,
  };
};
