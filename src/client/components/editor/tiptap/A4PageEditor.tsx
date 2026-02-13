import { useState, useEffect, useRef, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { BriefEditorProps } from '../types'
import { useBriefStore } from '../../../stores/useBriefStore'
import { useUIStore } from '../../../stores/useUIStore'
import { useAutoSave } from '../../../hooks/useAutoSave'
import { CitationNode } from './extensions/CitationNode'
import { LegalHeading } from './extensions/LegalHeading'
import { LegalParagraph } from './extensions/LegalParagraph'
import { contentStructuredToTiptapDoc, tiptapDocToContentStructured } from './converters'
import { CitationReviewModal } from './CitationReviewModal'
import { PrintPreviewModal } from './PrintPreviewModal'

export function A4PageEditor({ content }: BriefEditorProps) {
  const currentBrief = useBriefStore((s) => s.currentBrief)
  const citationStats = useBriefStore((s) => s.citationStats)
  const dirty = useBriefStore((s) => s.dirty)
  const saving = useBriefStore((s) => s.saving)
  const setTitle = useBriefStore((s) => s.setTitle)

  const stats = citationStats()

  const [citationReviewOpen, setCitationReviewOpen] = useState(false)
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Flag to prevent loop: when we update store from editor, don't re-sync editor
  const isInternalUpdate = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useAutoSave()

  // Paragraph double-click → jump to dispute in bottom panel
  const handleEditorDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const paragraphEl = target.closest('[data-dispute-id]') as HTMLElement | null
    if (!paragraphEl) return

    const disputeId = paragraphEl.getAttribute('data-dispute-id')
    if (!disputeId) return

    // Open bottom panel, switch to disputes tab, highlight the dispute card
    useUIStore.getState().setBottomPanelOpen(true)
    useUIStore.getState().setBottomPanelTab('disputes')
    useBriefStore.getState().setHighlightDisputeId(disputeId)

    // Scroll dispute card into view
    setTimeout(() => {
      const card = document.querySelector(`[data-dispute-card="${disputeId}"]`)
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
      }),
      LegalHeading,
      LegalParagraph,
      CitationNode,
    ],
    content: contentStructuredToTiptapDoc(content),
    editorProps: {
      attributes: {
        class: 'a4-editor-prose',
      },
    },
    onUpdate: ({ editor }) => {
      // Debounce: sync editor → store
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        isInternalUpdate.current = true
        const doc = editor.getJSON()
        const structured = tiptapDocToContentStructured(doc)

        const brief = useBriefStore.getState().currentBrief
        if (brief) {
          useBriefStore.setState({
            currentBrief: { ...brief, content_structured: structured },
            dirty: true,
          })
        }

        requestAnimationFrame(() => {
          isInternalUpdate.current = false
        })
      }, 500)
    },
  })

  // Sync external content changes (AI SSE updates) → editor
  useEffect(() => {
    if (!editor || !content || isInternalUpdate.current) return

    const editorDoc = editor.getJSON()
    const editorStructured = tiptapDocToContentStructured(editorDoc)
    const storeJson = JSON.stringify(content.paragraphs.map(p => p.id))
    const editorJson = JSON.stringify(editorStructured.paragraphs.map(p => p.id))

    if (storeJson !== editorJson) {
      const newDoc = contentStructuredToTiptapDoc(content)
      editor.commands.setContent(newDoc)
    }
  }, [content, editor])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  // Focus title input when entering edit mode
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  const handleTitleDoubleClick = () => {
    setTitleDraft(currentBrief?.title || '')
    setEditingTitle(true)
  }

  const handleTitleBlur = () => {
    setEditingTitle(false)
    if (titleDraft.trim() && titleDraft !== currentBrief?.title) {
      setTitle(titleDraft.trim())
    }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleTitleBlur()
    } else if (e.key === 'Escape') {
      setEditingTitle(false)
    }
  }

  const briefTitle = currentBrief?.title || '書狀'

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
        {/* Undo / Redo */}
        <button
          onClick={() => editor?.chain().focus().undo().run()}
          disabled={!editor?.can().undo()}
          className="rounded p-1 text-t3 hover:text-t1 hover:bg-bg-3 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-t3"
          title="復原 (Ctrl+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 7h7a3 3 0 0 1 0 6H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 4L3 7l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => editor?.chain().focus().redo().run()}
          disabled={!editor?.can().redo()}
          className="rounded p-1 text-t3 hover:text-t1 hover:bg-bg-3 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-t3"
          title="重做 (Ctrl+Shift+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M13 7H6a3 3 0 0 0 0 6h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
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

        <span className="mx-2 h-4 w-px bg-bd" />

        {/* Print preview button */}
        <button
          onClick={() => setPrintPreviewOpen(true)}
          className="rounded px-3 py-1 text-xs text-t3 hover:text-t1 hover:bg-bg-3"
        >
          列印預覽
        </button>

        {/* Save status (right side) */}
        <div className="ml-auto text-[11px]">
          {saving ? (
            <span className="text-t3">儲存中...</span>
          ) : content && !dirty ? (
            <span className="text-gr">&#10003; 已儲存</span>
          ) : null}
        </div>
      </div>

      {/* A4 Editor Area */}
      <div className="a4-editor-container min-h-0 flex-1 overflow-y-auto">
        {!content ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-t3">尚無書狀內容</p>
          </div>
        ) : (
          <div className="a4-editor-content">
            {/* Title — inside A4 page, editable on double-click */}
            <div className="a4-title" onDoubleClick={handleTitleDoubleClick}>
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={handleTitleKeyDown}
                  className="a4-title-input"
                />
              ) : (
                <span title="雙擊編輯標題">{briefTitle}</span>
              )}
            </div>

            {/* Tiptap Editor Content */}
            <div onDoubleClick={handleEditorDoubleClick}>
              <EditorContent editor={editor} />
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <CitationReviewModal
        open={citationReviewOpen}
        onClose={() => setCitationReviewOpen(false)}
      />
      {printPreviewOpen && editor && (
        <PrintPreviewModal
          html={editor.getHTML()}
          title={briefTitle}
          onClose={() => setPrintPreviewOpen(false)}
        />
      )}
    </div>
  )
}
