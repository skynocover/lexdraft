import type { Damage } from '../../stores/useAnalysisStore';
import { DamageCard } from './DamageCard';
import { cleanText, formatAmount } from '../../lib/textUtils';

interface DamageGroupProps {
  category: string;
  items: Damage[];
  onEdit: (damage: Damage) => void;
  onDelete: (damage: Damage) => void;
}

export const DamageGroup = ({ category, items, onEdit, onDelete }: DamageGroupProps) => {
  const groupTotal = items.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-t3">{cleanText(category)}</span>
        <span className="text-xs text-t3">{formatAmount(groupTotal)}</span>
      </div>
      {items.map((d) => (
        <DamageCard key={d.id} damage={d} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
};
