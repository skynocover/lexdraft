import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { Damage } from '../../stores/useAnalysisStore';
import { cleanText, formatAmount } from '../../lib/textUtils';

interface DamageCardProps {
  damage: Damage;
  onEdit: (damage: Damage) => void;
  onDelete: (damage: Damage) => void;
}

export const DamageCard = ({ damage, onEdit, onDelete }: DamageCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="rounded border border-bd bg-bg-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-bg-h"
      >
        <span className="flex-1 truncate text-sm text-t1">
          {cleanText(damage.description || damage.category)}
        </span>
        <span className="shrink-0 text-sm font-medium text-ac">{formatAmount(damage.amount)}</span>

        {hovered && (
          <div className="flex shrink-0 items-center gap-1">
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(damage);
              }}
              className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
            >
              <Pencil className="h-3.5 w-3.5" />
            </span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(damage);
              }}
              className="rounded p-1 text-t3 transition hover:bg-rd/10 hover:text-rd"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </span>
          </div>
        )}

        {!hovered && <span className="shrink-0 text-xs text-t3">{expanded ? '▾' : '▸'}</span>}
      </button>

      {expanded && damage.basis && (
        <div className="border-t border-bd px-3 py-2.5">
          <span className="text-xs font-medium text-t3">依據</span>
          <p className="mt-0.5 text-sm leading-relaxed text-t2">{cleanText(damage.basis)}</p>
        </div>
      )}
    </div>
  );
};
