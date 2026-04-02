import { useState, useEffect, useRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useBriefStore } from '../../../stores/useBriefStore';
import { useCaseStore } from '../../../stores/useCaseStore';
import { useTabStore } from '../../../stores/useTabStore';
import { forEachCitation } from '../../../lib/citationUtils';
import { DEFAULT_BRIEF_LABEL } from '../../../lib/caseConstants';
import { useAutoSave } from '../../../hooks/useAutoSave';
import { useSelectionToolbar } from '../../../hooks/useSelectionToolbar';
import { CitationNode } from './extensions/CitationNode';
import { ExhibitMark } from './extensions/ExhibitMark';
import { ExhibitMarkOverlay } from './extensions/ExhibitMarkOverlay';
import { LegalHeading } from './extensions/LegalHeading';
import { LegalParagraph } from './extensions/LegalParagraph';
import { PlaceholderHighlight } from './extensions/PlaceholderHighlight';
import { contentStructuredToTiptapDoc, tiptapDocToContentStructured } from './converters';
import { CitationReviewModal } from './CitationReviewModal';
import { PrintPreviewModal } from './PrintPreviewModal';
import { VersionPanel } from '../VersionPanel';
import { EditorToolbar } from './EditorToolbar';
import { SelectionToolbar } from './SelectionToolbar';
import { usePageInfo } from '../../../hooks/usePageInfo';

interface A4PageEditorProps {
  briefId: string;
}

export function A4PageEditor({ briefId }: A4PageEditorProps) {
  const briefState = useBriefStore((s) => s.briefCache[briefId]);
  const brief = briefState?.brief ?? null;
  const content = brief?.content_structured ?? null;
  const dirty = briefState?.dirty ?? false;
  const saving = briefState?.saving ?? false;
  const setTitle = useBriefStore((s) => s.setTitle);
  const isDemo = useCaseStore((s) => s.isDemo);

  const stats = useMemo(() => {
    if (!content?.paragraphs) return { confirmed: 0, pending: 0 };
    let confirmed = 0;
    let pending = 0;
    forEachCitation(content.paragraphs, (c) => {
      if (c.status === 'confirmed') confirmed++;
      else if (c.status === 'pending') pending++;
    });
    return { confirmed, pending };
  }, [content]);

  const [citationReviewOpen, setCitationReviewOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const pageInfo = usePageInfo(scrollContainerRef, contentRef, !!content);

  // Flag to prevent loop: when we update store from editor, don't re-sync editor
  const isInternalUpdate = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useAutoSave(briefId);

  const editor = useEditor({
    editable: !isDemo,
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
      }),
      LegalHeading,
      LegalParagraph,
      CitationNode,
      ExhibitMark,
      PlaceholderHighlight,
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

        useBriefStore.getState().updateBriefContent(briefId, structured);

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
      editor.commands.setContent(contentStructuredToTiptapDoc(content), { emitUpdate: false });
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
    setTitleDraft(brief?.title || '');
    setEditingTitle(true);
  };

  const handleTitleBlur = () => {
    setEditingTitle(false);
    const newTitle = titleDraft.trim();
    if (newTitle && newTitle !== brief?.title) {
      setTitle(newTitle, briefId);
      useTabStore.getState().updateBriefTabTitle(briefId, newTitle);
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

  const briefTitle = brief?.title || DEFAULT_BRIEF_LABEL;

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Toolbar */}
      <EditorToolbar
        editor={editor}
        brief={brief}
        stats={stats}
        dirty={dirty}
        saving={saving}
        hasContent={!!content}
        versionPanelOpen={versionPanelOpen}
        pageInfo={pageInfo}
        onCitationReview={() => setCitationReviewOpen(true)}
        onPrintPreview={() => setPrintPreviewOpen(true)}
        onToggleVersionPanel={() => setVersionPanelOpen((v) => !v)}
      />

      {/* A4 Editor Area */}
      <div ref={scrollContainerRef} className="a4-editor-container min-h-0 flex-1 overflow-y-auto">
        {!content ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-t3">尚無書狀內容</p>
          </div>
        ) : (
          <div ref={contentRef} className="a4-editor-content">
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
            <EditorContent editor={editor} />

            {/* Exhibit Mark Overlay (hover popover for inline exhibit references) */}
            <ExhibitMarkOverlay containerRef={contentRef} />
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
