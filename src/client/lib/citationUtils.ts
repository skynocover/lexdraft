import type { Paragraph, Citation } from '../stores/useBriefStore';

/**
 * Iterate all citations across paragraphs (both p.citations and p.segments[].citations)
 */
export const forEachCitation = (
  paragraphs: Paragraph[],
  callback: (citation: Citation, paragraph: Paragraph) => void,
) => {
  for (const p of paragraphs) {
    for (const c of p.citations) {
      callback(c, p);
    }
    if (p.segments) {
      for (const seg of p.segments) {
        for (const c of seg.citations) {
          callback(c, p);
        }
      }
    }
  }
};

/**
 * Map citations within a specific paragraph (both p.citations and p.segments[].citations)
 */
export const mapParagraphCitations = (
  paragraphs: Paragraph[],
  paragraphId: string,
  mapFn: (citations: Citation[]) => Citation[],
): Paragraph[] =>
  paragraphs.map((p) => {
    if (p.id !== paragraphId) return p;
    return {
      ...p,
      citations: mapFn(p.citations),
      segments: p.segments?.map((seg) => ({
        ...seg,
        citations: mapFn(seg.citations),
      })),
    };
  });
