import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CaseFile } from '../../../stores/useCaseStore';
import { useTabStore } from '../../../stores/useTabStore';
import { CATEGORY_CONFIG } from '../../../lib/categoryConfig';
import { ConfirmDialog } from './ConfirmDialog';

export function FileItem({
  file,
  groupKey,
  isRebuttalTarget,
  onDelete,
}: {
  file: CaseFile;
  groupKey: string;
  isRebuttalTarget: boolean;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const openFileTab = useTabStore((s) => s.openFileTab);
  const summary = file.summary ? JSON.parse(file.summary) : null;

  const focusedPanelId = useTabStore((s) => s.focusedPanelId);
  const panels = useTabStore((s) => s.panels);
  const focusedPanel = panels.find((p) => p.id === focusedPanelId);
  const isFileActive = focusedPanel?.activeTabId === `file:${file.id}`;

  const handleClick = () => {
    if (file.status === 'ready') {
      openFileTab(file.id, file.filename);
    }
  };

  const isProcessing = file.status === 'pending' || file.status === 'processing';
  const badge = CATEGORY_CONFIG[groupKey];

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/file-id', file.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div>
      <div
        draggable
        onDragStart={handleDragStart}
        className={`group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition cursor-grab active:cursor-grabbing ${
          isRebuttalTarget ? 'bg-yl/8' : isFileActive ? 'bg-ac/8' : 'hover:bg-bg-2'
        }`}
      >
        {/* Icon badge */}
        {badge && (
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${badge.badgeCls}`}
          >
            {badge.badge}
          </span>
        )}

        <button onClick={handleClick} className="flex-1 min-w-0 text-left">
          <p
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
          {file.doc_date && <p className="mt-0.5 text-xs text-t3">{file.doc_date}</p>}
          {isProcessing && <p className="mt-0.5 text-xs text-yl">處理中...</p>}
          {file.status === 'error' && <p className="mt-0.5 text-xs text-rd">處理失敗</p>}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {summary && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="rounded p-1 text-xs text-t3 transition hover:bg-bg-3 hover:text-t1"
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(true);
            }}
            className="rounded p-1 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
            title="刪除檔案"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && summary && (
        <div className="ml-14 mr-2 mb-1 rounded-lg bg-bg-2 p-3">
          <p className="mb-1 text-xs font-medium text-t3">AI 摘要</p>
          <p className="text-xs leading-relaxed text-t2">{summary.summary}</p>
          {summary.key_claims?.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {summary.key_claims.map((claim: string, i: number) => (
                <li key={i} className="text-xs text-t3">
                  · {claim}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message="確定刪除此檔案？"
          onConfirm={() => {
            onDelete(file.id);
            setConfirmDelete(false);
          }}
          onCancel={() => setConfirmDelete(false)}
        >
          <p className="truncate text-xs text-t3">{file.filename}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
