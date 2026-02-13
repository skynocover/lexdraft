import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { BriefEditorProps } from '../types'
import type { Paragraph, Citation, TextSegment } from '../../../stores/useBriefStore'
import { useBriefStore } from '../../../stores/useBriefStore'
import { useAutoSave } from '../../../hooks/useAutoSave'
import { ParagraphToolbar } from './ParagraphToolbar'
import { CitationReviewModal } from './CitationReviewModal'

function CitationBadge({ citation, index }: { citation: Citation; index?: number }) {
  const [showPopover, setShowPopover] = useState(false)
  const highlightCitationId = useBriefStore((s) => s.highlightCitationId)
  const isLaw = citation.type === 'law'
  const isPending = citation.status === 'pending'
  const isHighlighted = citation.id === highlightCitationId

  const badgeNum = index != null ? index + 1 : null

  let className = 'inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium cursor-pointer mx-0.5 relative align-super'

  if (isPending) {
    className += ' border border-dashed border-yl text-yl bg-yl/10'
  } else if (isLaw) {
    className += ' bg-pu/20 text-pu'
  } else {
    className += ' bg-ac/20 text-ac'
  }

  if (isHighlighted) {
    className += ' animate-pulse ring-2 ring-yl'
  }

  return (
    <span
      className={className}
      contentEditable={false}
      data-citation-id={citation.id}
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

/** Build CSS class for a citation badge DOM element (used when constructing edit-mode DOM) */
function buildCitationBadgeClass(citation: Citation): string {
  const highlightCitationId = useBriefStore.getState().highlightCitationId
  let cls = 'inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium cursor-pointer mx-0.5 align-super'

  if (citation.status === 'pending') {
    cls += ' border border-dashed border-yl text-yl bg-yl/10'
  } else if (citation.type === 'law') {
    cls += ' bg-pu/20 text-pu'
  } else {
    cls += ' bg-ac/20 text-ac'
  }

  if (citation.id === highlightCitationId) {
    cls += ' animate-pulse ring-2 ring-yl'
  }

  return cls
}

/** Check if citation positions changed between old and new segments */
function segmentsCitationsChanged(oldSegments: TextSegment[], newSegments: TextSegment[]): boolean {
  if (oldSegments.length !== newSegments.length) return true
  for (let i = 0; i < oldSegments.length; i++) {
    const oldCids = oldSegments[i].citations.map((c) => c.id).join(',')
    const newCids = newSegments[i].citations.map((c) => c.id).join(',')
    if (oldCids !== newCids) return true
  }
  return false
}

/** Get the full text of a paragraph (concatenate all segment texts, or use content_md) */
function getFullText(paragraph: Paragraph): string {
  if (paragraph.segments && paragraph.segments.length > 0) {
    return paragraph.segments.map((s) => s.text).join('')
  }
  return paragraph.content_md
}

/** Build a citation lookup from paragraph for extractSegmentsFromDOM */
function buildCitationMap(paragraph: Paragraph): Map<string, Citation> {
  const map = new Map<string, Citation>()
  for (const c of paragraph.citations) map.set(c.id, c)
  if (paragraph.segments) {
    for (const seg of paragraph.segments) {
      for (const c of seg.citations) map.set(c.id, c)
    }
  }
  return map
}

/**
 * Walk the DOM tree of a contentEditable div and reconstruct TextSegment[].
 * Text nodes accumulate into the current segment's text.
 * <br> elements add '\n' to text.
 * Elements with data-citation-id mark a citation at the current position.
 * After citation(s), subsequent text starts a new segment.
 */
function extractSegmentsFromDOM(container: HTMLElement, citationMap: Map<string, Citation>): TextSegment[] {
  const segments: TextSegment[] = []
  let currentText = ''
  let currentCitations: Citation[] = []

  function flush() {
    // Only flush if we have text or citations
    if (currentText || currentCitations.length > 0) {
      segments.push({ text: currentText, citations: currentCitations })
      currentText = ''
      currentCitations = []
    }
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (currentCitations.length > 0) {
        // We had citations — start a new segment for the text after citations
        flush()
      }
      currentText += text
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement

    // Check if this is a citation badge
    const citationId = el.getAttribute('data-citation-id')
    if (citationId) {
      const citation = citationMap.get(citationId)
      if (citation) {
        currentCitations.push(citation)
      }
      return // don't walk into citation badge children
    }

    // Handle <br> as newline
    if (el.tagName === 'BR') {
      currentText += '\n'
      return
    }

    // Recurse into children
    for (const child of Array.from(el.childNodes)) {
      walk(child)
    }
  }

  for (const child of Array.from(container.childNodes)) {
    walk(child)
  }

  // Flush remaining
  if (currentText || currentCitations.length > 0) {
    segments.push({ text: currentText, citations: currentCitations })
  }

  return segments
}

function ParagraphBlock({
  paragraph,
  showSection,
  showSubsection,
  highlighted,
  mode,
  pendingDelete,
  onSegmentsChange,
  onTextChange,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  paragraph: Paragraph
  showSection: boolean
  showSubsection: boolean
  highlighted: boolean
  mode: 'preview' | 'edit'
  pendingDelete: boolean
  onSegmentsChange: (paragraphId: string, newSegments: TextSegment[]) => void
  onTextChange: (paragraphId: string, newText: string) => void
  onRequestDelete: (paragraphId: string) => void
  onConfirmDelete: (paragraphId: string) => void
  onCancelDelete: (paragraphId: string) => void
}) {
  const isEdit = mode === 'edit'
  const editableRef = useRef<HTMLDivElement>(null)
  const isEditingRef = useRef(false)

  const fullText = useMemo(() => getFullText(paragraph), [paragraph])
  const citationMap = useMemo(() => buildCitationMap(paragraph), [paragraph])

  // Build the initial DOM content for edit mode (segments with inline citations)
  const syncDOMFromParagraph = useCallback(() => {
    const el = editableRef.current
    if (!el) return

    // Clear existing content
    el.innerHTML = ''

    if (paragraph.segments && paragraph.segments.length > 0) {
      let citationCounter = 0
      for (const seg of paragraph.segments) {
        // Add text (using text node, handle newlines with <br>)
        const lines = seg.text.split('\n')
        for (let li = 0; li < lines.length; li++) {
          if (li > 0) el.appendChild(document.createElement('br'))
          if (lines[li]) el.appendChild(document.createTextNode(lines[li]))
        }
        // Add citation badges inline
        for (const c of seg.citations) {
          const badge = document.createElement('span')
          badge.setAttribute('data-citation-id', c.id)
          badge.setAttribute('contenteditable', 'false')
          badge.className = buildCitationBadgeClass(c)
          badge.textContent = String(citationCounter + 1)
          el.appendChild(badge)
          citationCounter++
        }
      }
    } else {
      // Old format — just text + citations at end
      const lines = paragraph.content_md.split('\n')
      for (let li = 0; li < lines.length; li++) {
        if (li > 0) el.appendChild(document.createElement('br'))
        if (lines[li]) el.appendChild(document.createTextNode(lines[li]))
      }
      for (let ci = 0; ci < paragraph.citations.length; ci++) {
        const c = paragraph.citations[ci]
        const badge = document.createElement('span')
        badge.setAttribute('data-citation-id', c.id)
        badge.setAttribute('contenteditable', 'false')
        badge.className = buildCitationBadgeClass(c)
        badge.textContent = String(ci + 1)
        el.appendChild(badge)
      }
    }
  }, [paragraph])

  // Sync store → DOM only when user is NOT actively editing
  useEffect(() => {
    if (isEdit && editableRef.current && !isEditingRef.current) {
      syncDOMFromParagraph()
    }
  }, [isEdit, syncDOMFromParagraph])

  const handleFocus = useCallback(() => {
    isEditingRef.current = true
  }, [])

  const handleBlur = useCallback(() => {
    isEditingRef.current = false
    if (!editableRef.current) return

    if (paragraph.segments && paragraph.segments.length > 0) {
      // Extract segments from DOM, preserving inline citation positions
      const newSegments = extractSegmentsFromDOM(editableRef.current, citationMap)
      // Check if anything changed
      const oldText = fullText
      const newText = newSegments.map((s) => s.text).join('')
      if (newText !== oldText || segmentsCitationsChanged(paragraph.segments, newSegments)) {
        onSegmentsChange(paragraph.id, newSegments)
      }
    } else {
      // Old format paragraph — just extract text
      const newText = editableRef.current.innerText
      if (newText !== fullText) {
        onTextChange(paragraph.id, newText)
      }
    }
  }, [paragraph, fullText, citationMap, onSegmentsChange, onTextChange])

  // Intercept Enter → insert <br> instead of <div> to keep newline count consistent
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      document.execCommand('insertLineBreak')
    }
  }, [])

  // Render inline segments (shared between preview and edit mode display)
  const renderInlineContent = () => {
    if (paragraph.segments && paragraph.segments.length > 0) {
      let citationCounter = 0
      return paragraph.segments.map((seg, i) => (
        <span key={`${paragraph.id}-seg-${i}`}>
          <span style={{ whiteSpace: 'pre-wrap' }}>{seg.text}</span>
          {seg.citations.length > 0 && seg.citations.map((c) => {
            const idx = citationCounter++
            return <CitationBadge key={c.id} citation={c} index={idx} />
          })}
        </span>
      ))
    }
    // Old format
    return (
      <>
        <span style={{ whiteSpace: 'pre-wrap' }}>{paragraph.content_md}</span>
        {paragraph.citations.length > 0 && (
          <span className="ml-1">
            {paragraph.citations.map((c, i) => (
              <CitationBadge key={c.id} citation={c} index={i} />
            ))}
          </span>
        )}
      </>
    )
  }

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
        className={`group/para relative mb-4 rounded-sm px-3 py-2 text-sm leading-7 text-t1 transition ${
          pendingDelete
            ? 'line-through opacity-50 bg-rd/5'
            : highlighted
              ? 'bg-ac/10 outline outline-1 outline-ac/30'
              : 'hover:bg-bg-h/30'
        }`}
        style={{ fontFamily: '"Noto Serif TC", "Source Han Serif TC", serif' }}
      >
        {/* Floating toolbar (edit mode only) */}
        {isEdit && !pendingDelete && (
          <ParagraphToolbar
            section={paragraph.section}
            subsection={paragraph.subsection}
            textPreview={fullText}
            paragraphId={paragraph.id}
            onRequestDelete={onRequestDelete}
          />
        )}

        {/* Delete confirmation bar */}
        {pendingDelete && (
          <div className="absolute inset-x-0 -bottom-1 z-10 flex items-center gap-2 rounded bg-rd/10 border border-rd/30 px-3 py-1.5">
            <span className="text-xs text-rd">確定刪除此段落？</span>
            <button
              onClick={() => onConfirmDelete(paragraph.id)}
              className="rounded bg-rd px-2 py-0.5 text-xs font-medium text-bg-0 hover:bg-rd/80"
            >
              確認
            </button>
            <button
              onClick={() => onCancelDelete(paragraph.id)}
              className="rounded border border-bd px-2 py-0.5 text-xs text-t2 hover:bg-bg-3"
            >
              取消
            </button>
          </div>
        )}

        {/* Content rendering */}
        {isEdit ? (
          // Edit mode: contentEditable with inline citations rendered as DOM nodes
          <div
            ref={editableRef}
            contentEditable
            suppressContentEditableWarning
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="outline-none"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          />
        ) : (
          // Preview mode: React-rendered inline citations
          renderInlineContent()
        )}
      </div>
    </>
  )
}

export function TiptapEditor({
  content,
  onContentChange,
  onCitationClick,
  highlightParagraphs = [],
}: BriefEditorProps) {
  const currentBrief = useBriefStore((s) => s.currentBrief)
  const citationStats = useBriefStore((s) => s.citationStats)
  const editorMode = useBriefStore((s) => s.editorMode)
  const setEditorMode = useBriefStore((s) => s.setEditorMode)
  const dirty = useBriefStore((s) => s.dirty)
  const saving = useBriefStore((s) => s.saving)
  const removeParagraph = useBriefStore((s) => s.removeParagraph)
  const updateParagraphText = useBriefStore((s) => s.updateParagraphText)
  const updateParagraphFromEdit = useBriefStore((s) => s.updateParagraphFromEdit)
  const undo = useBriefStore((s) => s.undo)
  const redo = useBriefStore((s) => s.redo)
  const canUndo = useBriefStore((s) => s.canUndo)
  const canRedo = useBriefStore((s) => s.canRedo)

  const stats = citationStats()

  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set())
  const [citationReviewOpen, setCitationReviewOpen] = useState(false)

  useAutoSave()

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (!isMod || e.key.toLowerCase() !== 'z') return

      e.preventDefault()
      if (e.shiftKey) {
        redo()
      } else {
        undo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  const handleSegmentsChange = useCallback((paragraphId: string, newSegments: TextSegment[]) => {
    updateParagraphFromEdit(paragraphId, newSegments)
  }, [updateParagraphFromEdit])

  const handleTextChange = useCallback((paragraphId: string, newText: string) => {
    updateParagraphText(paragraphId, newText)
  }, [updateParagraphText])

  const handleRequestDelete = useCallback((paragraphId: string) => {
    setPendingDeletes((prev) => new Set(prev).add(paragraphId))
  }, [])

  const handleConfirmDelete = useCallback((paragraphId: string) => {
    removeParagraph(paragraphId)
    setPendingDeletes((prev) => {
      const next = new Set(prev)
      next.delete(paragraphId)
      return next
    })
  }, [removeParagraph])

  const handleCancelDelete = useCallback((paragraphId: string) => {
    setPendingDeletes((prev) => {
      const next = new Set(prev)
      next.delete(paragraphId)
      return next
    })
  }, [])

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
        {/* Preview / Edit mode toggle */}
        <button
          onClick={() => setEditorMode('preview')}
          className={`rounded px-3 py-1 text-xs ${
            editorMode === 'preview'
              ? 'bg-bg-3 text-ac'
              : 'text-t3 hover:text-t2'
          }`}
        >
          預覽
        </button>
        <button
          onClick={() => setEditorMode('edit')}
          className={`rounded px-3 py-1 text-xs ${
            editorMode === 'edit'
              ? 'bg-bg-3 text-ac'
              : 'text-t3 hover:text-t2'
          }`}
        >
          編輯
        </button>
        <span className="mx-2 h-4 w-px bg-bd" />

        {/* Undo / Redo */}
        <button
          onClick={undo}
          disabled={!canUndo()}
          className="rounded p-1 text-t3 hover:text-t1 hover:bg-bg-3 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-t3"
          title="復原 (Ctrl+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 7h7a3 3 0 0 1 0 6H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 4L3 7l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={redo}
          disabled={!canRedo()}
          className="rounded p-1 text-t3 hover:text-t1 hover:bg-bg-3 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-t3"
          title="重做 (Ctrl+Shift+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M13 7H6a3 3 0 0 0 0 6h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="mx-2 h-4 w-px bg-bd" />

        <button className="rounded px-3 py-1 text-xs text-t3" disabled>比對</button>
        <span className="mx-2 h-4 w-px bg-bd" />

        {/* Citation stats / review button */}
        {(stats.confirmed > 0 || stats.pending > 0) ? (
          <button
            onClick={() => stats.pending > 0 && setCitationReviewOpen(true)}
            className={`text-[11px] ${stats.pending > 0 ? 'hover:text-t1 cursor-pointer' : ''} text-t3`}
          >
            引用：<span className="text-gr">{stats.confirmed} 確認</span>
            {stats.pending > 0 && (
              <> · <span className="text-yl">{stats.pending} 待確認</span></>
            )}
          </button>
        ) : (
          <span className="text-[11px] text-t3">引用審查</span>
        )}

        {/* Save status (right side) */}
        <div className="ml-auto text-[11px]">
          {saving ? (
            <span className="text-t3">儲存中...</span>
          ) : content && !dirty ? (
            <span className="text-gr">&#10003; 已儲存</span>
          ) : null}
        </div>
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
                  showSection={showSection}
                  showSubsection={showSubsection}
                  highlighted={highlightParagraphs.includes(p.id)}
                  mode={editorMode}
                  pendingDelete={pendingDeletes.has(p.id)}
                  onSegmentsChange={handleSegmentsChange}
                  onTextChange={handleTextChange}
                  onRequestDelete={handleRequestDelete}
                  onConfirmDelete={handleConfirmDelete}
                  onCancelDelete={handleCancelDelete}
                />
              )
            })}
          </>
        )}
      </div>

      {/* Citation review modal */}
      <CitationReviewModal
        open={citationReviewOpen}
        onClose={() => setCitationReviewOpen(false)}
      />
    </div>
  )
}
