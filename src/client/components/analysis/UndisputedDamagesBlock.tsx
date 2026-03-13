import { type FC } from 'react';
import { ChevronRight, DollarSign, Plus } from 'lucide-react';
import type { Damage } from '../../stores/useAnalysisStore';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { InlineDamageItem } from './InlineDamageItem';
import { formatAmount } from '../../lib/textUtils';

export const UndisputedDamagesBlock: FC<{
  damages: Damage[];
  total: number;
  fileByName: Map<string, { id: string; filename: string }>;
  onAddDamage: (disputeId?: string | null) => void;
  onEditDamage: (d: Damage) => void;
  onDeleteDamage: (d: Damage) => void;
}> = ({ damages, total, fileByName, onAddDamage, onEditDamage, onDeleteDamage }) => {
  if (damages.length === 0) return null;

  return (
    <Collapsible className="rounded border border-bd bg-bg-2 px-3 py-2.5">
      <div className="flex items-center">
        <CollapsibleTrigger className="flex flex-1 items-center gap-1.5 text-left">
          <ChevronRight
            size={14}
            className="shrink-0 text-t3 transition-transform duration-200 [[data-state=open]>&]:rotate-90"
          />
          <DollarSign className="size-3.5 shrink-0 text-ac" />
          <span className="text-xs font-medium text-t2">不爭執金額</span>
          <span className="text-xs text-t3">({damages.length})</span>
          {total > 0 && <span className="ml-auto text-xs text-t3">{formatAmount(total)}</span>}
        </CollapsibleTrigger>
        <button
          type="button"
          onClick={() => onAddDamage(null)}
          className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <CollapsibleContent className="mt-2 space-y-1">
        {damages.map((d) => (
          <InlineDamageItem
            key={d.id}
            damage={d}
            onEdit={onEditDamage}
            onDelete={onDeleteDamage}
            showRefs
            fileByName={fileByName}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};
