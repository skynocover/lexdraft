import { useState, useMemo, type FC } from 'react';
import { ChevronRight, Pencil, Trash2 } from 'lucide-react';
import type { Damage } from '../../stores/useAnalysisStore';
import { cleanText, formatAmount, parseJsonArray } from '../../lib/textUtils';

interface InlineDamageItemProps {
  damage: Damage;
  onEdit: (damage: Damage) => void;
  onDelete: (damage: Damage) => void;
  /** Show evidence_refs below basis text (used in undisputed facts) */
  showRefs?: boolean;
}

export const InlineDamageItem: FC<InlineDamageItemProps> = ({
  damage,
  onEdit,
  onDelete,
  showRefs,
}) => {
  const [expanded, setExpanded] = useState(false);
  const basisText = damage.basis ? cleanText(damage.basis) : '';
  const refs = useMemo(
    () => (showRefs ? parseJsonArray(damage.evidence_refs) : []),
    [showRefs, damage.evidence_refs],
  );

  return (
    <div
      className="group cursor-pointer rounded bg-bg-1 px-2 py-1.5"
      onClick={() => basisText && setExpanded(!expanded)}
    >
      <div className="flex w-full items-center gap-2">
        <span className="flex-1 truncate text-xs text-t2">
          {cleanText(damage.description || damage.category)}
        </span>
        <span className="shrink-0 text-xs font-medium text-ac">{formatAmount(damage.amount)}</span>
        <span className="grid shrink-0 [&>*]:col-start-1 [&>*]:row-start-1">
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(damage);
              }}
              className="rounded p-0.5 text-t3 transition hover:bg-bg-h hover:text-t1"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(damage);
              }}
              className="rounded p-0.5 text-t3 transition hover:bg-rd/10 hover:text-rd"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
          {basisText && (
            <span className="flex items-center justify-end opacity-100 transition-opacity group-hover:opacity-0">
              <ChevronRight
                size={12}
                className={`text-t3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
              />
            </span>
          )}
        </span>
      </div>
      {expanded && basisText && <p className="mt-1 text-xs leading-relaxed text-t3">{basisText}</p>}
      {expanded && refs.length > 0 && (
        <p className="mt-0.5 text-xs text-t3/60">({refs.join(', ')})</p>
      )}
    </div>
  );
};
