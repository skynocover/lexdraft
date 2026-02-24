import { useMemo } from 'react';
import { useBriefStore, type LawRef } from '../stores/useBriefStore';
import { forEachCitation } from '../lib/citationUtils';

export const useCitedLawRefs = () => {
  const lawRefs = useBriefStore((s) => s.lawRefs);
  const paragraphs = useBriefStore((s) => s.currentBrief?.content_structured?.paragraphs);

  return useMemo(() => {
    const citedLabels = new Set<string>();
    if (paragraphs) {
      forEachCitation(paragraphs, (c) => {
        if (c.type === 'law') citedLabels.add(c.label);
      });
    }
    const cited: LawRef[] = [];
    const available: LawRef[] = [];
    for (const ref of lawRefs) {
      if (citedLabels.has(`${ref.law_name} ${ref.article}`)) {
        cited.push(ref);
      } else if (ref.is_manual) {
        available.push(ref);
      }
    }
    return { citedLawRefs: cited, availableLawRefs: available, citedCount: cited.length };
  }, [paragraphs, lawRefs]);
};
