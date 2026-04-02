import { useMemo } from 'react';
import { useBriefStore, type LawRef } from '../stores/useBriefStore';
import { forEachCitation } from '../lib/citationUtils';

export const useCitedLawRefs = () => {
  const lawRefs = useBriefStore((s) => s.lawRefs);
  const paragraphs = useBriefStore((s) => s.currentBrief?.content_structured?.paragraphs);

  return useMemo(() => {
    // Build a lookup from DB cache (label → LawRef with full_text)
    const dbLookup = new Map<string, LawRef>();
    for (const ref of lawRefs) {
      dbLookup.set(`${ref.law_name} ${ref.article}`, ref);
    }

    // Collect cited law labels from current brief paragraphs
    const citedLabels = new Map<string, LawRef>();
    if (paragraphs) {
      forEachCitation(paragraphs, (c) => {
        if (c.type === 'law' && !citedLabels.has(c.label)) {
          const cached = dbLookup.get(c.label);
          if (cached) {
            citedLabels.set(c.label, cached);
          } else {
            // Parse label "民法 第184條" → law_name + article
            const spaceIdx = c.label.indexOf(' ');
            const lawName = spaceIdx > 0 ? c.label.slice(0, spaceIdx) : c.label;
            const article = spaceIdx > 0 ? c.label.slice(spaceIdx + 1) : '';
            citedLabels.set(c.label, {
              id: c.label,
              law_name: lawName,
              article,
              full_text: '',
              is_manual: false,
            });
          }
        }
      });
    }

    const cited = Array.from(citedLabels.values());

    // Manual laws not cited in this brief
    const available: LawRef[] = [];
    for (const ref of lawRefs) {
      if (ref.is_manual && !citedLabels.has(`${ref.law_name} ${ref.article}`)) {
        available.push(ref);
      }
    }

    return { citedLawRefs: cited, availableLawRefs: available, citedCount: cited.length };
  }, [paragraphs, lawRefs]);
};
