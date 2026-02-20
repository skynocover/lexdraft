import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, Eye, Undo2, Trash2, Plus } from 'lucide-react';
import { useBriefStore } from '../../stores/useBriefStore';
import { useTabStore } from '../../stores/useTabStore';
import { ConfirmDialog } from '../layout/sidebar/ConfirmDialog';

interface VersionPanelProps {
  open: boolean;
  onClose: () => void;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hour}:${min}`;
};

export function VersionPanel({ open, onClose }: VersionPanelProps) {
  const currentBrief = useBriefStore((s) => s.currentBrief);
  const versions = useBriefStore((s) => s.versions);
  const loadVersions = useBriefStore((s) => s.loadVersions);
  const createVersion = useBriefStore((s) => s.createVersion);
  const deleteVersion = useBriefStore((s) => s.deleteVersion);
  const restoreVersion = useBriefStore((s) => s.restoreVersion);
  const openVersionPreviewTab = useTabStore((s) => s.openVersionPreviewTab);

  const panelRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  useEffect(() => {
    if (open && currentBrief) {
      loadVersions(currentBrief.id);
    }
  }, [open, currentBrief?.id, loadVersions]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !confirmDelete &&
        !confirmRestore
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, confirmDelete, confirmRestore]);

  const handleCreate = useCallback(async () => {
    const label = labelDraft.trim();
    if (!label) return;
    await createVersion(label);
    setLabelDraft('');
    setCreating(false);
  }, [labelDraft, createVersion]);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteVersion(id);
      setConfirmDelete(null);
    },
    [deleteVersion],
  );

  const handleRestore = useCallback(
    async (id: string) => {
      await restoreVersion(id);
      setConfirmRestore(null);
    },
    [restoreVersion],
  );

  const handlePreview = useCallback(
    (versionId: string, briefId: string, label: string) => {
      const briefTitle = currentBrief?.title || '書狀';
      openVersionPreviewTab(versionId, briefId, label, briefTitle);
    },
    [openVersionPreviewTab, currentBrief?.title],
  );

  if (!open) return null;

  return (
    <>
      <div ref={panelRef} className="absolute right-3 top-14 z-20 w-56">
        <div className="rounded-lg border border-bd bg-bg-1/95 shadow-lg backdrop-blur-sm">
          {/* Header */}
          <button
            onClick={onClose}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-t2 transition hover:bg-bg-h"
          >
            <ChevronRight size={12} />
            版本紀錄
          </button>

          {/* Version list */}
          <div className="max-h-72 overflow-y-auto border-t border-bd px-1 py-1">
            {versions.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-t3">尚無版本紀錄</p>
            ) : (
              versions.map((v) => (
                <div
                  key={v.id}
                  className="group relative rounded px-2 py-1.5 transition hover:bg-bg-h"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-t1">{v.label}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-t3">{formatTime(v.created_at)}</div>

                  {/* Hover actions */}
                  <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 gap-0.5 group-hover:flex">
                    <button
                      onClick={() => handlePreview(v.id, v.brief_id, v.label)}
                      className="rounded p-1 text-t3 hover:bg-bg-3 hover:text-t1"
                      title="預覽"
                    >
                      <Eye size={12} />
                    </button>
                    <button
                      onClick={() => setConfirmRestore(v.id)}
                      className="rounded p-1 text-t3 hover:bg-bg-3 hover:text-ac"
                      title="還原"
                    >
                      <Undo2 size={12} />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(v.id)}
                      className="rounded p-1 text-t3 hover:bg-bg-3 hover:text-rd"
                      title="刪除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Create new version */}
          <div className="border-t border-bd px-2 py-2">
            {creating ? (
              <div className="flex gap-1">
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') setCreating(false);
                  }}
                  placeholder="版本名稱..."
                  className="min-w-0 flex-1 rounded border border-bd bg-bg-2 px-2 py-1 text-xs text-t1 outline-none focus:border-ac"
                />
                <button
                  onClick={handleCreate}
                  className="shrink-0 rounded bg-ac px-2 py-1 text-xs font-medium text-bg-0 hover:opacity-90"
                >
                  建立
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center justify-center gap-1 rounded py-1 text-xs text-t2 transition hover:bg-bg-h hover:text-t1"
              >
                <Plus size={12} />
                建立新版本
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDialog
          message="確定刪除此版本？"
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Confirm restore dialog */}
      {confirmRestore && (
        <ConfirmDialog
          message="確定還原到此版本？目前的內容將被覆蓋。"
          confirmLabel="還原"
          variant="primary"
          onConfirm={() => handleRestore(confirmRestore)}
          onCancel={() => setConfirmRestore(null)}
        />
      )}
    </>
  );
}
