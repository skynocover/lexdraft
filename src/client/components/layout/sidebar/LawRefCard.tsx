import { useState } from 'react'
import type { LawRef } from '../../../stores/useBriefStore'

export function LawRefCard({ lawRef }: { lawRef: LawRef }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded border border-bd bg-bg-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left transition hover:bg-bg-h"
      >
        <span className="mt-0.5 shrink-0 rounded bg-purple-500/20 px-1 py-0.5 text-[9px] font-medium text-purple-400">
          法規
        </span>
        <div className="flex-1 min-w-0">
          <p className="truncate text-xs text-t1">{lawRef.law_name} {lawRef.article}</p>
        </div>
        {lawRef.usage_count && lawRef.usage_count > 0 && (
          <span className="shrink-0 text-[9px] text-t3">{lawRef.usage_count}次</span>
        )}
        <span className="shrink-0 text-[10px] text-t3">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && lawRef.full_text && (
        <div className="border-t border-bd px-2 py-1.5">
          <p className="text-[11px] leading-4 text-t2">{lawRef.full_text}</p>
        </div>
      )}
    </div>
  )
}
