import { FileText, AlertTriangle } from 'lucide-react';
import type { StructuredFact } from '../../stores/useAnalysisStore';

const ASSERTION_STYLES: Record<StructuredFact['assertion_type'], { bg: string; text: string }> = {
  承認: { bg: 'bg-emerald-500/15', text: 'text-gr' },
  爭執: { bg: 'bg-amber-500/15', text: 'text-or' },
  自認: { bg: 'bg-sky-500/15', text: 'text-cy' },
  推定: { bg: 'bg-violet-500/15', text: 'text-pu' },
  主張: { bg: 'bg-bg-3', text: 'text-t2' },
};

export const FactList = ({ facts }: { facts: StructuredFact[] }) => {
  return (
    <div>
      <span className="text-[10px] font-medium text-t3">事實爭議</span>
      <div className="mt-1 space-y-1.5">
        {facts.map((fact) => {
          const style = ASSERTION_STYLES[fact.assertion_type] || ASSERTION_STYLES['主張'];
          return (
            <div key={fact.id} className="rounded border border-bd/50 bg-bg-1 px-2 py-1.5">
              <div className="flex items-start gap-1.5">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${style.bg} ${style.text}`}
                >
                  {fact.assertion_type}
                </span>
                <p className="flex-1 text-xs leading-relaxed text-t2">{fact.description}</p>
              </div>

              {fact.source_side !== '中立' && (
                <span className="mt-1 inline-block text-[9px] text-t3">
                  來源：{fact.source_side}
                </span>
              )}

              {fact.disputed_by && (
                <div className="mt-1 flex items-start gap-1 rounded bg-amber-500/5 px-1.5 py-1">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-or" />
                  <p className="text-[10px] leading-relaxed text-or">{fact.disputed_by}</p>
                </div>
              )}

              {fact.evidence.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <FileText className="size-3 text-t3" />
                  {fact.evidence.map((e, i) => (
                    <span key={i} className="rounded bg-bg-3 px-1 py-0.5 text-[9px] text-t3">
                      {e}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
