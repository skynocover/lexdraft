import { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'react-markdown';
import { Save, Check, Copy, Eye, Pencil } from 'lucide-react';
import { useTemplateStore } from '../../stores/useTemplateStore';
import { useTabStore } from '../../stores/useTabStore';

export const TemplateEditor = () => {
  const currentTemplate = useTemplateStore((s) => s.currentTemplate);
  const dirty = useTemplateStore((s) => s.dirty);
  const saving = useTemplateStore((s) => s.saving);
  const setContentMd = useTemplateStore((s) => s.setContentMd);
  const setTitle = useTemplateStore((s) => s.setTitle);
  const saveTemplate = useTemplateStore((s) => s.saveTemplate);
  const duplicateTemplate = useTemplateStore((s) => s.duplicateTemplate);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isDefault = currentTemplate?.is_default === 1;
  const contentMd = currentTemplate?.content_md ?? '';

  // Auto-save effect (only for custom templates)
  useEffect(() => {
    if (!dirty || saving || isDefault) return;

    autoSaveTimer.current = setTimeout(() => {
      saveTemplate();
    }, 2000);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [dirty, saving, saveTemplate, isDefault]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, []);

  // Title editing
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

  const handleDuplicate = useCallback(async () => {
    if (!currentTemplate) return;
    const newTpl = await duplicateTemplate(currentTemplate.id);
    useTabStore.getState().openTemplateTab(newTpl.id, newTpl.title);
  }, [currentTemplate, duplicateTemplate]);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContentMd(e.target.value);
    },
    [setContentMd],
  );

  const templateTitle = currentTemplate?.title || '範本';

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-bd px-4 py-2">
        <span className="text-xs font-medium text-t2">
          {isDefault ? '系統範本（唯讀）' : '範本編輯'}
        </span>
        <div className="flex-1" />

        {isDefault ? (
          <button
            onClick={handleDuplicate}
            className="flex items-center gap-1 rounded bg-ac/15 px-2 py-1 text-xs text-ac transition hover:bg-ac/25"
          >
            <Copy size={12} />
            <span>複製為我的範本</span>
          </button>
        ) : (
          <>
            {/* Edit/Preview toggle */}
            <div className="flex rounded border border-bd">
              <button
                onClick={() => setMode('edit')}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition ${
                  mode === 'edit' ? 'bg-bg-3 text-t1' : 'text-t3 hover:text-t1'
                }`}
              >
                <Pencil size={10} />
                <span>編輯</span>
              </button>
              <button
                onClick={() => setMode('preview')}
                className={`flex items-center gap-1 px-2 py-1 text-xs transition ${
                  mode === 'preview' ? 'bg-bg-3 text-t1' : 'text-t3 hover:text-t1'
                }`}
              >
                <Eye size={10} />
                <span>預覽</span>
              </button>
            </div>

            {/* Save status */}
            {dirty ? (
              <button
                onClick={handleManualSave}
                disabled={saving}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-t3 transition hover:bg-bg-h hover:text-t1 disabled:opacity-50"
                title="儲存範本"
              >
                <Save size={12} />
                <span>{saving ? '儲存中...' : '儲存'}</span>
              </button>
            ) : (
              <span className="flex items-center gap-1 text-xs text-t3">
                <Check size={12} />
                <span>已儲存</span>
              </span>
            )}
          </>
        )}
      </div>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!contentMd ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-t3">尚無範本內容</p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-8 py-6">
            {/* Title */}
            <div className="mb-4" onDoubleClick={handleTitleDoubleClick}>
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={handleTitleKeyDown}
                  className="w-full border-b border-ac bg-transparent text-lg font-bold text-t1 outline-none"
                />
              ) : (
                <h1
                  className="text-lg font-bold text-t1"
                  title={isDefault ? undefined : '雙擊編輯標題'}
                >
                  {templateTitle}
                </h1>
              )}
            </div>

            {/* Markdown content */}
            {isDefault || mode === 'preview' ? (
              <div className="prose-legal text-t1">
                <Markdown>{contentMd}</Markdown>
              </div>
            ) : (
              <textarea
                value={contentMd}
                onChange={handleContentChange}
                className="min-h-120 w-full resize-y rounded border border-bd bg-bg-3 p-4 font-mono text-xs text-t1 outline-none placeholder:text-t3 focus:border-ac"
                placeholder="在此編輯 Markdown 格式的範本內容..."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
