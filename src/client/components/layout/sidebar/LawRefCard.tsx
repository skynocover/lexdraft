import { X } from 'lucide-react';
import type { LawRef } from '../../../stores/useBriefStore';
import { useTabStore } from '../../../stores/useTabStore';

interface LawRefCardProps {
  lawRef: LawRef;
  cited?: boolean;
  onRemove?: (id: string) => void;
}

export function LawRefCard({ lawRef, cited, onRemove }: LawRefCardProps) {
  const handleClick = () => {
    useTabStore
      .getState()
      .openLawTab(lawRef.id, lawRef.law_name ?? '', lawRef.article ?? '', lawRef.full_text ?? null);
  };

  return (
    <div className="group">
      <button
        onClick={handleClick}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-bg-2"
      >
        {/* § icon badge */}
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold ${
            cited ? 'bg-gr/10 text-gr' : 'bg-pu/10 text-pu'
          }`}
        >
          §
        </span>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-t1">
            {lawRef.law_name} {lawRef.article}
          </p>
          {lawRef.full_text && (
            <p className="truncate text-xs text-t3">
              {lawRef.full_text.slice(0, 40)}
              {lawRef.full_text.length > 40 ? '...' : ''}
            </p>
          )}
        </div>
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(lawRef.id);
            }}
            className="shrink-0 rounded p-1 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
            title="移除"
          >
            <X size={14} />
          </button>
        )}
      </button>
    </div>
  );
}
