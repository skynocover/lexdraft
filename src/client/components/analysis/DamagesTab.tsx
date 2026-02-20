import { useState } from 'react';
import { useAnalysisStore, type Damage } from '../../stores/useAnalysisStore';
import { cleanText } from '../../lib/textUtils';

function formatAmount(amount: number): string {
  return `NT$ ${amount.toLocaleString()}`;
}

export function DamagesTab() {
  const damages = useAnalysisStore((s) => s.damages);

  if (damages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-t3">尚未計算金額，透過 AI 助理計算</p>
      </div>
    );
  }

  // Group by category
  const grouped = damages.reduce<Record<string, Damage[]>>((acc, d) => {
    const key = d.category;
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});

  const totalAmount = damages.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto">
        {Object.entries(grouped).map(([category, items]) => (
          <DamageGroup key={category} category={category} items={items} />
        ))}
      </div>

      {/* Total bar */}
      <div className="mt-2 shrink-0 rounded border border-ac/30 bg-ac/10 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-ac">請求總額</span>
          <span className="text-sm font-bold text-ac">{formatAmount(totalAmount)}</span>
        </div>
      </div>
    </div>
  );
}

function DamageGroup({ category, items }: { category: string; items: Damage[] }) {
  const groupTotal = items.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-medium text-t3">{cleanText(category)}</span>
        <span className="text-[11px] text-t3">{formatAmount(groupTotal)}</span>
      </div>
      {items.map((d) => (
        <DamageCard key={d.id} damage={d} />
      ))}
    </div>
  );
}

function DamageCard({ damage }: { damage: Damage }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-bd bg-bg-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-bg-h"
      >
        <span className="flex-1 truncate text-xs text-t1">
          {cleanText(damage.description || damage.category)}
        </span>
        <span className="shrink-0 text-xs font-medium text-ac">{formatAmount(damage.amount)}</span>
        <span className="shrink-0 text-[11px] text-t3">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-1.5 border-t border-bd px-3 py-2">
          {damage.basis && (
            <div>
              <span className="text-[11px] font-medium text-t3">依據</span>
              <p className="mt-0.5 text-xs leading-relaxed text-t2">{cleanText(damage.basis)}</p>
            </div>
          )}

          {damage.evidence_refs && damage.evidence_refs.length > 0 && (
            <div>
              <span className="text-[11px] font-medium text-t3">證據</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {damage.evidence_refs.map((e, i) => (
                  <span key={i} className="rounded bg-bg-3 px-1.5 py-0.5 text-[11px] text-t2">
                    {cleanText(e)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
