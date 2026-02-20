import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useBriefStore } from '../../../stores/useBriefStore';
import { useTabStore } from '../../../stores/useTabStore';
import { ConfirmDialog } from './ConfirmDialog';

const BRIEF_TYPE_LABEL: Record<string, string> = {
  complaint: '起訴狀',
  defense: '答辯狀',
  preparation: '準備書狀',
  appeal: '上訴狀',
};

export const BriefsSection = ({ activeTabId }: { activeTabId: string | null }) => {
  const briefs = useBriefStore((s) => s.briefs);
  const deleteBrief = useBriefStore((s) => s.deleteBrief);
  const openBriefTab = useTabStore((s) => s.openBriefTab);
  const closeTab = useTabStore((s) => s.closeTab);

  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const handleDeleteBrief = async () => {
    if (!confirmDelete) return;
    const briefId = confirmDelete.id;
    setConfirmDelete(null);

    const tabId = `brief:${briefId}`;
    const { panels: currentPanels } = useTabStore.getState();
    const ownerPanel = currentPanels.find((p) => p.tabIds.includes(tabId));
    if (ownerPanel) {
      closeTab(tabId, ownerPanel.id);
    }
    await deleteBrief(briefId);
  };

  return (
    <div>
      {confirmDelete && (
        <ConfirmDialog
          message={`確定要刪除「${confirmDelete.title}」嗎？此操作無法復原。`}
          onConfirm={handleDeleteBrief}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {briefs.length === 0 ? (
        <div className="px-4 py-3">
          <p className="text-xs text-t3">尚無書狀</p>
        </div>
      ) : (
        <div className="px-3 py-2 space-y-1">
          {briefs.map((b) => {
            const tabId = `brief:${b.id}`;
            const isActive = activeTabId === tabId;
            const title = b.title || b.brief_type;
            return (
              <div
                key={b.id}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                  isActive ? 'bg-ac/8' : 'hover:bg-bg-2'
                }`}
              >
                <button
                  onClick={() => openBriefTab(b.id, title)}
                  className="flex flex-1 items-center gap-3 min-w-0"
                >
                  {/* DOC icon badge */}
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-xs font-bold ${
                      isActive ? 'border-ac bg-ac/10 text-ac' : 'border-bd text-t3'
                    }`}
                  >
                    DOC
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`truncate text-sm font-medium ${isActive ? 'text-ac' : 'text-t1'}`}
                    >
                      {b.title || '書狀'}
                    </p>
                    <p className="text-xs text-t3">
                      {BRIEF_TYPE_LABEL[b.brief_type] || b.brief_type}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => setConfirmDelete({ id: b.id, title })}
                  className="shrink-0 rounded p-1 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
                  title="刪除書狀"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
