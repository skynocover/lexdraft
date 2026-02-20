import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useBriefStore } from '../../../stores/useBriefStore';
import { LawRefCard } from './LawRefCard';
import { LawSearchDialog } from './LawSearchDialog';

export const LawRefsSection = () => {
  const lawRefs = useBriefStore((s) => s.lawRefs);
  const currentBrief = useBriefStore((s) => s.currentBrief);
  const removeLawRef = useBriefStore((s) => s.removeLawRef);

  const [lawSearchOpen, setLawSearchOpen] = useState(false);

  const citedLabels = useMemo(() => {
    const labels = new Set<string>();
    if (!currentBrief?.content_structured?.paragraphs) return labels;
    for (const p of currentBrief.content_structured.paragraphs) {
      for (const c of p.citations) {
        if (c.type === 'law') labels.add(c.label);
      }
      if (p.segments) {
        for (const seg of p.segments) {
          for (const c of seg.citations) {
            if (c.type === 'law') labels.add(c.label);
          }
        }
      }
    }
    return labels;
  }, [currentBrief]);

  const { citedLawRefs, availableLawRefs } = useMemo(() => {
    const cited: typeof lawRefs = [];
    const available: typeof lawRefs = [];
    for (const ref of lawRefs) {
      const label = `${ref.law_name} ${ref.article}`;
      if (citedLabels.has(label)) {
        cited.push(ref);
      } else if (ref.is_manual) {
        available.push(ref);
      }
    }
    return { citedLawRefs: cited, availableLawRefs: available };
  }, [lawRefs, citedLabels]);

  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-t2">法條引用</span>
          {lawRefs.length > 0 && <span className="text-xs text-t3">{lawRefs.length} 條</span>}
        </div>
        <button
          onClick={() => setLawSearchOpen(true)}
          className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-ac"
          title="搜尋法條"
        >
          <Search size={16} />
        </button>
      </div>

      <div className="px-3 pb-4">
        {citedLawRefs.length === 0 && availableLawRefs.length === 0 ? (
          <div className="py-3 text-center">
            <p className="text-sm text-t3">尚無法條</p>
            <button
              onClick={() => setLawSearchOpen(true)}
              className="mt-1.5 text-sm text-ac transition hover:underline"
            >
              搜尋並加入法條
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {citedLawRefs.length > 0 && (
              <>
                <p className="px-1 pt-1 text-xs font-medium text-t3">
                  已引用 ({citedLawRefs.length})
                </p>
                {citedLawRefs.map((ref) => (
                  <LawRefCard key={ref.id} lawRef={ref} cited onRemove={removeLawRef} />
                ))}
              </>
            )}
            {availableLawRefs.length > 0 && (
              <>
                <p className="px-1 pt-2 text-xs font-medium text-t3">
                  備用 ({availableLawRefs.length})
                </p>
                {availableLawRefs.map((ref) => (
                  <LawRefCard key={ref.id} lawRef={ref} onRemove={removeLawRef} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <LawSearchDialog open={lawSearchOpen} onClose={() => setLawSearchOpen(false)} />
    </div>
  );
};
