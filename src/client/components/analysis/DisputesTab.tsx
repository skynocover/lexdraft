import { useState, useEffect } from 'react';
import { useAnalysisStore } from '../../stores/useAnalysisStore';
import { cleanText } from '../../lib/textUtils';
import { FactList } from './FactList';

export function DisputesTab() {
  const disputes = useAnalysisStore((s) => s.disputes);
  const highlightDisputeId = useAnalysisStore((s) => s.highlightDisputeId);

  if (disputes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-t3">尚未分析爭點，透過 AI 助理分析</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {disputes.map((d) => (
        <DisputeCard key={d.id} dispute={d} isHighlighted={d.id === highlightDisputeId} />
      ))}
    </div>
  );
}

function DisputeCard({
  dispute,
  isHighlighted,
}: {
  dispute: ReturnType<typeof useAnalysisStore.getState>['disputes'][number];
  isHighlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const setHighlightDisputeId = useAnalysisStore((s) => s.setHighlightDisputeId);

  // Auto-expand and scroll into view when highlighted
  useEffect(() => {
    if (isHighlighted) {
      setExpanded(true);
      // Clear highlight after 3 seconds
      const timer = setTimeout(() => {
        setHighlightDisputeId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isHighlighted, setHighlightDisputeId]);

  const handleJumpToParagraph = () => {
    // Find paragraph element with matching dispute_id
    const el = document.querySelector(`[data-dispute-id="${dispute.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-paragraph');
      setTimeout(() => el.classList.remove('highlight-paragraph'), 3000);
    }
  };

  return (
    <div
      className={`rounded border bg-bg-2 transition-colors ${
        isHighlighted ? 'border-yl bg-yl/10' : 'border-bd'
      }`}
      data-dispute-card={dispute.id}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-bg-h"
      >
        <span className="shrink-0 rounded bg-ac/20 px-1.5 py-0.5 text-xs font-medium text-ac">
          {dispute.number}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-t1">
          {cleanText(dispute.title || '未命名爭點')}
        </span>
        <span className="shrink-0 text-xs text-t3">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-2.5 border-t border-bd px-3 py-2.5">
          {dispute.our_position && (
            <div>
              <span className="text-xs font-medium text-ac">我方主張</span>
              <p className="mt-0.5 text-sm leading-relaxed text-t2">
                {cleanText(dispute.our_position)}
              </p>
            </div>
          )}

          {dispute.their_position && (
            <div>
              <span className="text-xs font-medium text-or">對方主張</span>
              <p className="mt-0.5 text-sm leading-relaxed text-t2">
                {cleanText(dispute.their_position)}
              </p>
            </div>
          )}

          {dispute.facts && dispute.facts.length > 0 && <FactList facts={dispute.facts} />}

          {dispute.evidence && dispute.evidence.length > 0 && (
            <div>
              <span className="text-xs font-medium text-t3">證據</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {dispute.evidence.map((e, i) => (
                  <span key={i} className="rounded bg-bg-3 px-1.5 py-0.5 text-xs text-t2">
                    {cleanText(e)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {dispute.law_refs && dispute.law_refs.length > 0 && (
            <div>
              <span className="text-xs font-medium text-t3">法條</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {dispute.law_refs.map((l, i) => (
                  <span key={i} className="rounded bg-cy/10 px-1.5 py-0.5 text-xs text-cy">
                    {cleanText(l)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button onClick={handleJumpToParagraph} className="mt-1 text-xs text-t3 hover:text-ac">
            跳到段落 →
          </button>
        </div>
      )}
    </div>
  );
}
