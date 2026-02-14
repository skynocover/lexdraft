import { useState } from "react";
import type { LawRef } from "../../../stores/useBriefStore";

interface LawRefCardProps {
  lawRef: LawRef;
  cited?: boolean;
  onRemove?: (id: string) => void;
}

export function LawRefCard({ lawRef, cited, onRemove }: LawRefCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`group rounded border ${
        cited ? "border-pu/25 bg-pu/5" : "border-bd bg-bg-2"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left transition hover:bg-bg-h"
      >
        <span
          className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
            cited ? "bg-pu/20 text-pu" : "bg-bg-3 text-t3"
          }`}
        >
          {cited ? "引用" : "備用"}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`truncate text-xs ${cited ? "text-t1" : "text-t2"}`}>
            {lawRef.law_name} {lawRef.article}
          </p>
        </div>
        {!cited && onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(lawRef.id);
            }}
            className="shrink-0 rounded p-0.5 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
            title="移除"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <span className="shrink-0 text-[10px] text-t3">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
      </button>
      {expanded && lawRef.full_text && (
        <div className="border-t border-bd px-2 py-1.5">
          <p className="text-[11px] leading-4 text-t2">{lawRef.full_text}</p>
        </div>
      )}
    </div>
  );
}
