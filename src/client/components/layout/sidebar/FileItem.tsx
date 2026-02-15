import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CaseFile } from '../../../stores/useCaseStore';
import { useTabStore } from '../../../stores/useTabStore';

export function FileItem({
  file,
  isRebuttalTarget,
  onDelete,
}: {
  file: CaseFile;
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

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/file-id', file.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="mb-px">
      <div
        draggable
        onDragStart={handleDragStart}
        className={`group flex w-full items-start gap-1.5 rounded px-2 py-1.5 text-left transition cursor-grab active:cursor-grabbing ${
          isRebuttalTarget ? 'bg-yl/10' : isFileActive ? 'bg-ac/10' : 'hover:bg-bg-h'
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="mt-0.5 shrink-0 rounded p-1 text-[10px] text-t3 hover:bg-bg-3 hover:text-t1"
        >
          {expanded ? '\u25BE' : '\u25B8'}
        </button>
        <button onClick={handleClick} className="flex-1 min-w-0 text-left">
          <p
            className={`truncate text-xs leading-snug ${
              isRebuttalTarget
                ? 'text-yl font-medium'
                : isFileActive
                  ? 'text-ac font-medium'
                  : 'text-t2'
            }`}
          >
            {isRebuttalTarget && '* '}
            {file.filename}
          </p>
          {file.doc_date && <p className="mt-0.5 text-[10px] text-t3">{file.doc_date}</p>}
        </button>
        {isProcessing && <span className="mt-1 shrink-0 text-[9px] text-yl">...</span>}
        {file.status === 'error' && <span className="mt-1 shrink-0 text-[9px] text-rd">!</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(true);
          }}
          className="mt-0.5 shrink-0 rounded p-1 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
          title="刪除檔案"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {expanded && (
        <div className="ml-5 mr-2 mb-1 rounded bg-bg-2 p-2">
          {file.status === 'ready' && summary ? (
            <>
              <p className="mb-1 text-[9px] font-medium uppercase tracking-wider text-t3">
                AI 摘要
              </p>
              <p className="text-[11px] leading-4 text-t2">{summary.summary}</p>
              {summary.key_claims?.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {summary.key_claims.map((claim: string, i: number) => (
                    <li key={i} className="text-[10px] text-t3">
                      · {claim}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : file.status === 'error' ? (
            <p className="text-[11px] text-rd">處理失敗</p>
          ) : (
            <p className="text-[11px] text-t3">處理中...</p>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-72 rounded-lg border border-bd bg-bg-1 p-4 shadow-xl">
            <p className="mb-1 text-sm text-t1">確定刪除此檔案？</p>
            <p className="mb-4 truncate text-xs text-t3">{file.filename}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded border border-bd px-3 py-1 text-xs text-t2 transition hover:bg-bg-h"
              >
                取消
              </button>
              <button
                onClick={() => {
                  onDelete(file.id);
                  setConfirmDelete(false);
                }}
                className="rounded bg-rd px-3 py-1 text-xs text-white transition hover:bg-rd/80"
              >
                刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
