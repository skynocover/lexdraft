import { Check } from 'lucide-react';
import type { SimpleFact } from '../../stores/useAnalysisStore';

export const UndisputedFactList = ({ facts }: { facts: SimpleFact[] }) => (
  <div className="space-y-1">
    {facts.map((fact) => (
      <div key={fact.id} className="flex items-start gap-1.5 text-sm text-t2">
        <Check className="mt-0.5 size-3.5 shrink-0 text-gr" />
        <span>{fact.description}</span>
      </div>
    ))}
  </div>
);
