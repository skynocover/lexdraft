import { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { BriefEditorProps } from '../types';
import { useBriefStore } from '../../../stores/useBriefStore';
import { useTabStore } from '../../../stores/useTabStore';
import { useAnalysisStore } from '../../../stores/useAnalysisStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useAutoSave } from '../../../hooks/useAutoSave';
import { useSelectionToolbar } from '../../../hooks/useSelectionToolbar';
import { CitationNode } from './extensions/CitationNode';
import { LegalHeading } from './extensions/LegalHeading';
import { LegalParagraph } from './extensions/LegalParagraph';
import { contentStructuredToTiptapDoc, tiptapDocToContentStructured } from './converters';
import { CitationReviewModal } from './CitationReviewModal';
import { PrintPreviewModal } from './PrintPreviewModal';
import { VersionPanel } from '../VersionPanel';
import { EditorToolbar } from './EditorToolbar';
import { SelectionToolbar } from './SelectionToolbar';

export function A4PageEditor({ content }: BriefEditorProps) {
  const currentBrief = useBriefStore((s) => s.currentBrief);
  const citationStats = useBriefStore((s) => s.citationStats);
  const dirty = useBriefStore((s) => s.dirty);
  const saving = useBriefStore((s) => s.saving);
  const setTitle = useBriefStore((s) => s.setTitle);

  const stats = citationStats();

  const [citationReviewOpen, setCitationReviewOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Flag to prevent loop: when we update store from editor, don't re-sync editor
  const isInternalUpdate = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useAutoSave();

  // Paragraph double-click → jump to dispute in bottom panel
  const handleEditorDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const paragraphEl = target.closest('[data-dispute-id]') as HTMLElement | null;
    if (!paragraphEl) return;

    const disputeId = paragraphEl.getAttribute('data-dispute-id');
    if (!disputeId) return;

    useUIStore.getState().setBottomPanelOpen(true);
    useUIStore.getState().setBottomPanelTab('disputes');
    useAnalysisStore.getState().setHighlightDisputeId(disputeId);

    setTimeout(() => {
      const card = document.querySelector(`[data-dispute-card="${disputeId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, []);

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
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        isInternalUpdate.current = true;
        const doc = editor.getJSON();
        const structured = tiptapDocToContentStructured(doc);

        const brief = useBriefStore.getState().currentBrief;
        if (brief) {
          useBriefStore.setState({
            currentBrief: { ...brief, content_structured: structured },
            dirty: true,
          });
        }

        requestAnimationFrame(() => {
          isInternalUpdate.current = false;
        });
      }, 500);
    },
  });

  // Selection toolbar hook
  const selection = useSelectionToolbar(editor);

  // Sync external content changes (AI SSE updates) → editor
  useEffect(() => {
    if (!editor || !content || isInternalUpdate.current) return;

    const editorDoc = editor.getJSON();
    const editorStructured = tiptapDocToContentStructured(editorDoc);
    const storeJson = JSON.stringify(content.paragraphs.map((p) => p.id));
    const editorJson = JSON.stringify(editorStructured.paragraphs.map((p) => p.id));

    if (storeJson !== editorJson) {
      const newDoc = contentStructuredToTiptapDoc(content);
      editor.commands.setContent(newDoc);
    }
  }, [content, editor]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // Focus title input when entering edit mode
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleTitleDoubleClick = () => {
    setTitleDraft(currentBrief?.title || '');
    setEditingTitle(true);
  };

  const handleTitleBlur = () => {
    setEditingTitle(false);
    const newTitle = titleDraft.trim();
    if (newTitle && newTitle !== currentBrief?.title) {
      setTitle(newTitle);
      if (currentBrief) {
        useTabStore.getState().updateBriefTabTitle(currentBrief.id, newTitle);
      }
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleBlur();
    } else if (e.key === 'Escape') {
      setEditingTitle(false);
    }
  };

  const briefTitle = currentBrief?.title || '書狀';

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Toolbar */}
      <EditorToolbar
        editor={editor}
        stats={stats}
        dirty={dirty}
        saving={saving}
        hasContent={!!content}
        versionPanelOpen={versionPanelOpen}
        onCitationReview={() => setCitationReviewOpen(true)}
        onPrintPreview={() => setPrintPreviewOpen(true)}
        onToggleVersionPanel={() => setVersionPanelOpen((v) => !v)}
      />

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

      {/* Selection Toolbar (inline AI) */}
      <SelectionToolbar
        isVisible={selection.isVisible}
        position={selection.position}
        isLoading={selection.isLoading}
        onTransform={selection.handleTransform}
        onDiscussInChat={selection.handleDiscussInChat}
      />

      {/* Version Panel */}
      <VersionPanel open={versionPanelOpen} onClose={() => setVersionPanelOpen(false)} />

      {/* Modals */}
      <CitationReviewModal open={citationReviewOpen} onClose={() => setCitationReviewOpen(false)} />
      {printPreviewOpen && editor && (
        <PrintPreviewModal
          html={editor.getHTML()}
          title={briefTitle}
          onClose={() => setPrintPreviewOpen(false)}
        />
      )}
    </div>
  );
}
