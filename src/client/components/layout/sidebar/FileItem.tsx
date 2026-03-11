import { useState } from 'react';
import { Trash2, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CaseFile } from '../../../stores/useCaseStore';
import { useCaseStore } from '../../../stores/useCaseStore';
import { formatROCDate } from '../../../lib/dateUtils';
import { useBriefStore, type Exhibit } from '../../../stores/useBriefStore';
import { useTabStore } from '../../../stores/useTabStore';
import { CATEGORY_CONFIG, SELECTABLE_CATEGORIES } from '../../../lib/categoryConfig';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';

const DOC_TYPES = ['影本', '正本', '繕本'] as const;

interface FileItemProps {
  file: CaseFile;
  exhibit?: Exhibit;
  isRebuttalTarget: boolean;
  onDelete: (id: string) => void;
  onCategoryChange: (fileId: string, category: string) => void;
  dragHandleProps?: Record<string, unknown>;
}

/** Wrapper that adds sortable behavior — only used inside SortableContext */
export function SortableFileItem(
  props: Omit<FileItemProps, 'dragHandleProps'> & { exhibit: Exhibit },
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.exhibit.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <FileItem {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

export function FileItem({
  file,
  exhibit,
  isRebuttalTarget,
  onDelete,
  onCategoryChange,
  dragHandleProps,
}: FileItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [docTypePopoverOpen, setDocTypePopoverOpen] = useState(false);
  const openFileTab = useTabStore((s) => s.openFileTab);
  const currentCase = useCaseStore((s) => s.currentCase);
  const updateExhibit = useBriefStore((s) => s.updateExhibit);

  const focusedPanelId = useTabStore((s) => s.focusedPanelId);
  const panels = useTabStore((s) => s.panels);
  const focusedPanel = panels.find((p) => p.id === focusedPanelId);
  const isFileActive = focusedPanel?.activeTabId === `file:${file.id}`;

  const caseId = currentCase?.id || '';

  const handleClick = () => {
    if (file.status === 'ready') {
      openFileTab(file.id, file.filename);
    }
  };

  const isProcessing = file.status === 'pending' || file.status === 'processing';
  const categoryKey = file.category || 'other';
  const catConfig = CATEGORY_CONFIG[categoryKey] || CATEGORY_CONFIG.other;

  return (
    <div>
      <div
        className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition ${
          isRebuttalTarget ? 'bg-yl/8' : isFileActive ? 'bg-ac/8' : 'hover:bg-bg-2'
        }`}
      >
        {/* Drag handle — only for exhibits */}
        {dragHandleProps && (
          <span {...dragHandleProps} className="shrink-0 cursor-grab text-t3 hover:text-t1">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}

        {/* Badge: exhibit short label (甲1) or category badge — click to change category */}
        <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className={`flex h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center rounded-full px-1 text-xs font-bold transition hover:ring-2 hover:ring-current/30 hover:brightness-125 ${exhibit ? (exhibit.prefix === '乙證' ? 'bg-rd/10 text-rd' : 'bg-or/10 text-or') : catConfig.badgeCls}`}
            >
              {exhibit
                ? `${(exhibit.prefix || '甲證').replace('證', '')}${exhibit.number ?? ''}`
                : catConfig.badge}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-36 p-1" side="bottom" align="start">
            {SELECTABLE_CATEGORIES.map((key) => {
              const config = CATEGORY_CONFIG[key];
              return (
                <button
                  key={key}
                  onClick={() => {
                    onCategoryChange(file.id, key);
                    setCategoryPopoverOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition hover:bg-bg-2 ${
                    categoryKey === key ? 'text-ac' : 'text-t1'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${config.badgeCls}`}
                  >
                    {config.badge}
                  </span>
                  {config.label}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>

        {/* Filename + date */}
        <button onClick={handleClick} className="min-w-0 flex-1 text-left">
          <p
            title={file.filename}
            className={`truncate text-sm leading-snug ${
              isRebuttalTarget
                ? 'text-yl font-medium'
                : isFileActive
                  ? 'text-ac font-medium'
                  : 'text-t1'
            }`}
          >
            {isRebuttalTarget && '* '}
            {file.filename}
          </p>
          {(file.doc_date || exhibit) && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-t3">
              {file.doc_date && <span>{formatROCDate(file.doc_date)}</span>}
              {file.doc_date && exhibit && <span>·</span>}
              {exhibit && caseId && (
                <Popover open={docTypePopoverOpen} onOpenChange={setDocTypePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="rounded px-1 text-xs text-t3 transition hover:bg-bg-3 hover:text-t1"
                    >
                      {exhibit.doc_type || '影本'} ›
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-24 p-1" side="bottom" align="start">
                    {DOC_TYPES.map((type) => (
                      <button
                        key={type}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateExhibit(caseId, exhibit.id, { doc_type: type });
                          setDocTypePopoverOpen(false);
                        }}
                        className={`flex w-full rounded px-2 py-1.5 text-xs transition hover:bg-bg-2 ${
                          (exhibit.doc_type || '影本') === type ? 'text-ac' : 'text-t1'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </p>
          )}
          {isProcessing && <p className="mt-0.5 text-xs text-yl">處理中...</p>}
          {file.status === 'error' && <p className="mt-0.5 text-xs text-rd">處理失敗</p>}
        </button>

        {/* Delete */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(true);
          }}
          className="shrink-0 rounded p-1 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
          title="刪除檔案"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        description="確定刪除此檔案？"
        onConfirm={() => {
          onDelete(file.id);
          setConfirmDelete(false);
        }}
      >
        <p className="truncate text-xs text-t3">{file.filename}</p>
      </ConfirmDialog>
    </div>
  );
}
