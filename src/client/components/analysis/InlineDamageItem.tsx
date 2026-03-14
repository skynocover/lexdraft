import { useMemo, type FC } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { Damage } from '../../stores/useAnalysisStore';
import {
  cleanText,
  formatAmount,
  parseJsonArray,
  DAMAGE_FALLBACK_LABEL,
} from '../../lib/textUtils';
import { FileRefTags } from './FileRefTags';

interface InlineDamageItemProps {
  damage: Damage;
  onEdit: (damage: Damage) => void;
  onDelete: (damage: Damage) => void;
  /** Show evidence_refs below basis text (used in undisputed damages) */
  showRefs?: boolean;
  /** File lookup map for clickable refs */
  fileByName?: Map<string, { id: string; filename: string }>;
}

export const InlineDamageItem: FC<InlineDamageItemProps> = ({
  damage,
  onEdit,
  onDelete,
  showRefs,
  fileByName,
}) => {
  const basisText = damage.basis ? cleanText(damage.basis) : '';
  const refs = useMemo(
    () => (showRefs ? parseJsonArray(damage.evidence_refs) : []),
    [showRefs, damage.evidence_refs],
  );

  return (
    <div className="group rounded bg-bg-1 px-2 py-1.5">
      <div className="flex w-full items-center gap-2">
        <span className="flex-1 truncate text-xs text-t2">
          {cleanText(damage.description || DAMAGE_FALLBACK_LABEL)}
        </span>
        <span className="shrink-0 text-xs font-medium text-ac">{formatAmount(damage.amount)}</span>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onEdit(damage)}
            className="rounded p-0.5 text-t3 transition hover:bg-bg-h hover:text-t1"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(damage)}
            className="rounded p-0.5 text-t3 transition hover:bg-rd/10 hover:text-rd"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </div>
      {basisText && <p className="mt-1 text-xs leading-relaxed text-t3">{basisText}</p>}
      {refs.length > 0 && fileByName && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          <FileRefTags refs={refs} fileByName={fileByName} />
        </div>
      )}
    </div>
  );
};
