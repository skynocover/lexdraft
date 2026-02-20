/**
 * UTF-8 text sanitization utilities.
 *
 * SSE streaming can split multi-byte UTF-8 characters across chunk boundaries,
 * producing U+FFFD replacement characters. These helpers detect and repair
 * such corruption before data is persisted to D1.
 */

/** Returns true if the string contains U+FFFD replacement characters. */
export const hasReplacementChars = (text: string | null | undefined): boolean => {
  if (!text) return false;
  return text.includes('\uFFFD');
};

/**
 * Build a lookup map from law_name + article → full_text.
 * Used to replace corrupted quoted_text in citations with clean D1 data.
 */
export const buildLawTextMap = (
  refs: { law_name: string | null; article: string | null; full_text: string | null }[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const ref of refs) {
    if (ref.law_name && ref.article && ref.full_text) {
      map.set(`${ref.law_name} ${ref.article}`, ref.full_text);
    }
  }
  return map;
};

/**
 * Repair law citations whose quoted_text contains replacement characters.
 * Replaces with correct text from the provided law text map.
 * Mutates citations in-place and returns the count of repairs.
 */
export const repairLawCitations = (
  citations: { type: string; label: string; quoted_text?: string | null }[],
  lawTextMap: Map<string, string>,
): number => {
  let repaired = 0;
  for (const c of citations) {
    if (c.type !== 'law') continue;
    if (!hasReplacementChars(c.quoted_text)) continue;
    const correct = lawTextMap.get(c.label);
    if (correct) {
      c.quoted_text = correct;
      repaired++;
    }
  }
  return repaired;
};
