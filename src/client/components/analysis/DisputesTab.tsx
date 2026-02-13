import { useState, useEffect } from 'react'
import { useBriefStore } from '../../stores/useBriefStore'
import { useUIStore } from '../../stores/useUIStore'

/** Strip emoji, U+FFFD replacement chars, and other non-text symbols */
function cleanText(text: string): string {
  return text
    .replace(/\uFFFD/g, '')
    .replace(/[\u{1F600}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
    .replace(/[\u{200D}]/gu, '')
    .replace(/[\u{20E3}]/gu, '')
    .replace(/[\u{E0020}-\u{E007F}]/gu, '')
    .trim()
}

export function DisputesTab() {
  const disputes = useBriefStore((s) => s.disputes)
  const highlightDisputeId = useBriefStore((s) => s.highlightDisputeId)

  if (disputes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-t3">尚未分析爭點，請在聊天面板輸入「分析爭點」</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {disputes.map((d) => (
        <DisputeCard key={d.id} dispute={d} isHighlighted={d.id === highlightDisputeId} />
      ))}
    </div>
  )
}

function DisputeCard({ dispute, isHighlighted }: { dispute: ReturnType<typeof useBriefStore.getState>['disputes'][number]; isHighlighted?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const setHighlightDisputeId = useBriefStore((s) => s.setHighlightDisputeId)

  // Auto-expand and scroll into view when highlighted
  useEffect(() => {
    if (isHighlighted) {
      setExpanded(true)
      // Clear highlight after 3 seconds
      const timer = setTimeout(() => {
        setHighlightDisputeId(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [isHighlighted, setHighlightDisputeId])

  const handleJumpToParagraph = () => {
    // Find paragraph element with matching dispute_id
    const el = document.querySelector(`[data-dispute-id="${dispute.id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('highlight-paragraph')
      setTimeout(() => el.classList.remove('highlight-paragraph'), 3000)
    }
  }

  return (
    <div
      className={`rounded border bg-bg-2 transition-colors ${
        isHighlighted ? 'border-yl bg-yl/10' : 'border-bd'
      }`}
      data-dispute-card={dispute.id}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-bg-h"
      >
        <span className="shrink-0 rounded bg-ac/20 px-1.5 py-0.5 text-[10px] font-medium text-ac">
          {dispute.number}
        </span>
        <span className="flex-1 truncate text-xs font-medium text-t1">
          {cleanText(dispute.title || '未命名爭點')}
        </span>
        <span className="shrink-0 text-[10px] text-t3">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-bd px-3 py-2">
          {dispute.our_position && (
            <div>
              <span className="text-[10px] font-medium text-ac">我方主張</span>
              <p className="mt-0.5 text-xs leading-relaxed text-t2">{cleanText(dispute.our_position)}</p>
            </div>
          )}

          {dispute.their_position && (
            <div>
              <span className="text-[10px] font-medium text-or">對方主張</span>
              <p className="mt-0.5 text-xs leading-relaxed text-t2">{cleanText(dispute.their_position)}</p>
            </div>
          )}

          {dispute.evidence && dispute.evidence.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-t3">證據</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {dispute.evidence.map((e, i) => (
                  <span key={i} className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] text-t2">
                    {cleanText(e)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {dispute.law_refs && dispute.law_refs.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-t3">法條</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {dispute.law_refs.map((l, i) => (
                  <span key={i} className="rounded bg-cy/10 px-1.5 py-0.5 text-[10px] text-cy">
                    {cleanText(l)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleJumpToParagraph}
            className="mt-1 text-[10px] text-t3 hover:text-ac"
          >
            跳到段落 →
          </button>
        </div>
      )}
    </div>
  )
}
