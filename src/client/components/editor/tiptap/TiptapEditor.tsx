import { useState } from 'react'
import type { BriefEditorProps } from '../types'
import type { Paragraph, Citation, TextSegment } from '../../../stores/useBriefStore'
import { useBriefStore } from '../../../stores/useBriefStore'

function CitationBadge({ citation, index }: { citation: Citation; index?: number }) {
  const [showPopover, setShowPopover] = useState(false)
  const isLaw = citation.type === 'law'
  const isPending = citation.status === 'pending'

  // Short label for inline display
  const badgeNum = index != null ? index + 1 : null

  let className = 'inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium cursor-pointer mx-0.5 relative align-super'

  if (isPending) {
    className += ' border border-dashed border-yl text-yl bg-yl/10'
  } else if (isLaw) {
    className += ' bg-pu/20 text-pu'
  } else {
    className += ' bg-ac/20 text-ac'
  }

  return (
    <span
      className={className}
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      {badgeNum != null ? badgeNum : citation.label}
      {showPopover && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 w-96 -translate-x-1/2 rounded-lg border border-bd bg-bg-1 p-3 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              isLaw ? 'bg-pu/20 text-pu' : 'bg-ac/20 text-ac'
            }`}>
              {isLaw ? '法條' : '文件'}
            </span>
            <span className="truncate text-xs font-medium text-t1">{citation.label}</span>
            {isPending && (
              <span className="shrink-0 rounded bg-yl/20 px-1 py-0.5 text-[9px] text-yl">待確認</span>
            )}
          </div>
          {citation.quoted_text && (
            <div className="max-h-48 overflow-y-auto rounded bg-bg-2 p-2.5">
              <p className="whitespace-pre-wrap text-xs leading-5 text-t1 border-l-2 border-ac/40 pl-2.5">
                {citation.quoted_text}
              </p>
            </div>
          )}
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-bd" />
        </div>
      )}
    </span>
  )
}

function ParagraphBlock({
  paragraph,
  isFirst,
  showSection,
  showSubsection,
  highlighted,
  onCitationClick,
}: {
  paragraph: Paragraph
  isFirst: boolean
  showSection: boolean
  showSubsection: boolean
  highlighted: boolean
  onCitationClick: (id: string) => void
}) {
  return (
    <>
      {showSection && (
        <h2 className="mt-8 mb-4 text-base font-bold text-t1 first:mt-0">
          {paragraph.section}
        </h2>
      )}
      {showSubsection && paragraph.subsection && (
        <h3 className="mt-5 mb-3 text-sm font-semibold text-t1">
          {paragraph.subsection}
        </h3>
      )}
      <div
        data-p={paragraph.id}
        data-dispute={paragraph.dispute_id || undefined}
        className={`group relative mb-4 rounded-sm px-3 py-2 text-sm leading-7 text-t1 transition ${
          highlighted ? 'bg-ac/10 outline outline-1 outline-ac/30' : 'hover:bg-bg-h/30'
        }`}
        style={{ fontFamily: '"Noto Serif TC", "Source Han Serif TC", serif' }}
      >
        {paragraph.segments && paragraph.segments.length > 0 ? (
          // Inline citations: each segment followed by its numbered citation badges
          (() => {
            let citationCounter = 0
            return paragraph.segments.map((seg, i) => (
              <span key={i}>
                <span>{seg.text}</span>
                {seg.citations.length > 0 && seg.citations.map((c) => {
                  const idx = citationCounter++
                  return <CitationBadge key={c.id} citation={c} index={idx} />
                })}
              </span>
            ))
          })()
        ) : (
          // Fallback: old format (content_md + citations at end)
          <>
            <span>{paragraph.content_md}</span>
            {paragraph.citations.length > 0 && (
              <span className="ml-1">
                {paragraph.citations.map((c, i) => (
                  <CitationBadge key={c.id} citation={c} index={i} />
                ))}
              </span>
            )}
          </>
        )}
      </div>
    </>
  )
}

export function TiptapEditor({
  content,
  mode,
  onContentChange,
  onCitationClick,
  highlightParagraphs = [],
}: BriefEditorProps) {
  const currentBrief = useBriefStore((s) => s.currentBrief)
  const citationStats = useBriefStore((s) => s.citationStats)
  const stats = citationStats()

  // Preview mode: render structured content directly (no Tiptap needed)
  if (mode === 'preview' || !content) {
    return (
      <div className="flex-1 overflow-y-auto">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
          <button className="rounded bg-bg-3 px-3 py-1 text-xs text-ac">預覽</button>
          <button className="rounded px-3 py-1 text-xs text-t3" disabled>編輯</button>
          <span className="mx-2 h-4 w-px bg-bd" />
          <button className="rounded px-3 py-1 text-xs text-t3" disabled>比對</button>
          <span className="mx-2 h-4 w-px bg-bd" />
          {(stats.confirmed > 0 || stats.pending > 0) ? (
            <span className="text-[11px] text-t3">
              引用：<span className="text-gr">{stats.confirmed} 確認</span>
              {stats.pending > 0 && (
                <> · <span className="text-yl">{stats.pending} 待確認</span></>
              )}
            </span>
          ) : (
            <span className="text-[11px] text-t3">引用審查</span>
          )}
        </div>

        {/* Content */}
        <div className="mx-auto max-w-3xl px-8 py-6">
          {!content ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-sm text-t3">尚無書狀內容</p>
            </div>
          ) : (
            <>
              {/* Brief header */}
              <div className="mb-8 text-center">
                <h1 className="text-xl font-bold text-t1" style={{ fontFamily: '"Noto Serif TC", serif' }}>
                  {currentBrief?.title || '書狀'}
                </h1>
              </div>

              {/* Paragraphs */}
              {content.paragraphs.map((p, i) => {
                const prev = i > 0 ? content.paragraphs[i - 1] : null
                const showSection = !prev || prev.section !== p.section
                const showSubsection = !prev || prev.subsection !== p.subsection || showSection
                return (
                  <ParagraphBlock
                    key={p.id}
                    paragraph={p}
                    isFirst={i === 0}
                    showSection={showSection}
                    showSubsection={showSubsection}
                    highlighted={highlightParagraphs.includes(p.id)}
                    onCitationClick={onCitationClick}
                  />
                )
              })}
            </>
          )}
        </div>
      </div>
    )
  }

  // Edit mode (future): Tiptap WYSIWYG
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <p className="text-sm text-t3">編輯模式尚未啟用</p>
    </div>
  )
}
