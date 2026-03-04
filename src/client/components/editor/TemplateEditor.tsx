import { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { Undo2, Redo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTemplateStore } from '../../stores/useTemplateStore';
import { useTabStore } from '../../stores/useTabStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { ConfirmDialog } from '../layout/sidebar/ConfirmDialog';

export const TemplateEditor = () => {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const dirty = useTemplateStore((s) => s.dirty);
  const saving = useTemplateStore((s) => s.saving);
  const setContentMd = useTemplateStore((s) => s.setContentMd);
  const setTitle = useTemplateStore((s) => s.setTitle);
  const saveTemplate = useTemplateStore((s) => s.saveTemplate);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);

  const [editingTitle, setEditingTitle] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const isInternalUpdate = useRef(false);

  const isDefault = currentTemplate?.is_default === 1;

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: currentTemplate?.content_md ?? '',
    editable: !isDefault,
    editorProps: {
      attributes: {
        class: 'a4-editor-prose',
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (isInternalUpdate.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (ed.storage as unknown as Record<string, MarkdownStorage>).markdown.getMarkdown();
      setContentMd(md);
    },
  });

  // Sync editable when template changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!isDefault);
  }, [editor, isDefault]);

  // Sync content when template switches or editor becomes ready
  useEffect(() => {
    if (!editor || isInternalUpdate.current) return;
    isInternalUpdate.current = true;
    editor.commands.setContent(currentTemplate?.content_md ?? '');
    requestAnimationFrame(() => {
      isInternalUpdate.current = false;
    });
  }, [editor, currentTemplate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save (custom templates only)
  useEffect(() => {
    if (!dirty || saving || isDefault) return;
    const timer = setTimeout(() => saveTemplate(), 2000);
    return () => clearTimeout(timer);
  }, [dirty, saving, saveTemplate, isDefault]);

  // Title editing focus
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleTitleDoubleClick = () => {
    if (isDefault) return;
    setTitleDraft(currentTemplate?.title || '');
    setEditingTitle(true);
  };

  const handleTitleBlur = () => {
    setEditingTitle(false);
    const newTitle = titleDraft.trim();
    if (newTitle && newTitle !== currentTemplate?.title) {
      setTitle(newTitle);
      if (currentTemplate) {
        useTabStore.getState().updateTemplateTabTitle(currentTemplate.id, newTitle);
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

  const handleManualSave = useCallback(() => {
    if (dirty && !saving && !isDefault) saveTemplate();
  }, [dirty, saving, saveTemplate, isDefault]);

  const handleDelete = useCallback(async () => {
    if (!currentTemplate || isDefault) return;
    const templateId = currentTemplate.id;
    setConfirmDelete(false);

    // 關閉此範本的 tab
    const tabId = `template:${templateId}`;
    const { panels } = useTabStore.getState();
    const ownerPanel = panels.find((p) => p.tabIds.includes(tabId));
    if (ownerPanel) {
      useTabStore.getState().closeTab(tabId, ownerPanel.id);
    }

    // 如果當前案件選了這個範本，重設為 auto
    const { currentCase, updateCase } = useCaseStore.getState();
    if (currentCase?.template_id === templateId) {
      updateCase(currentCase.id, { template_id: 'auto' });
    }

    try {
      await deleteTemplate(templateId);
      toast.success('範本已刪除');
    } catch {
      toast.error('刪除範本失敗');
    }
  }, [currentTemplate, isDefault, deleteTemplate]);

  const templateTitle = currentTemplate?.title || '範本';

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Toolbar — matches EditorToolbar layout */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-bd bg-bg-1 px-4 py-2">
        {isDefault ? (
          <span className="text-xs text-t3">系統範本（唯讀）</span>
        ) : (
          <>
            {/* Undo / Redo */}
            <button
              onClick={() => editor?.chain().focus().undo().run()}
              disabled={!editor?.can().undo()}
              className="rounded p-1 text-t3 hover:bg-bg-3 hover:text-t1 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-t3"
              title="復原 (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={() => editor?.chain().focus().redo().run()}
              disabled={!editor?.can().redo()}
              className="rounded p-1 text-t3 hover:bg-bg-3 hover:text-t1 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-t3"
              title="重做 (Ctrl+Shift+Z)"
            >
              <Redo2 size={14} />
            </button>
            <span className="mx-2 h-4 w-px bg-bd" />
            <span className="text-xs text-t3">範本編輯</span>
          </>
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-1">
          {!isDefault && (
            <>
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded px-3 py-1 text-xs text-t3 hover:bg-bg-3 hover:text-rd"
              >
                刪除範本
              </button>
              <span className="mx-1 h-4 w-px bg-bd" />
            </>
          )}
          <div className="text-xs">
            {isDefault ? null : saving ? (
              <span className="text-t3">儲存中...</span>
            ) : !dirty ? (
              <span className="text-gr">&#10003; 已儲存</span>
            ) : (
              <button onClick={handleManualSave} className="text-t3 hover:text-t1">
                未儲存
              </button>
            )}
          </div>
        </div>
      </div>

      {/* A4 Editor Area */}
      <div className="a4-editor-container min-h-0 flex-1 overflow-y-auto">
        {!currentTemplate ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-t3">載入中...</p>
          </div>
        ) : (
          <div className="a4-editor-content">
            {/* Title */}
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
                <span title={isDefault ? undefined : '雙擊編輯標題'}>{templateTitle}</span>
              )}
            </div>

            {/* Tiptap Editor Content */}
            <EditorContent editor={editor} />
          </div>
        )}
      </div>
      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDialog
          message={`確定要刪除範本「${templateTitle}」嗎？此操作無法復原。`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
};
