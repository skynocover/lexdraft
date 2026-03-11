import { useState, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBriefStore } from '../../../stores/useBriefStore';
import { useTabStore } from '../../../stores/useTabStore';
import { ConfirmDialog } from '../../ui/confirm-dialog';
import { DEFAULT_BRIEF_LABEL } from '../../../lib/caseConstants';

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
};

export const BriefsSection = ({ activeTabId }: { activeTabId: string | null }) => {
  const briefs = useBriefStore((s) => s.briefs);
  const dirtyMap = useBriefStore(
    useShallow((s) => {
      const m: Record<string, boolean> = {};
      for (const [id, bs] of Object.entries(s.briefCache)) {
        m[id] = bs.dirty;
      }
      return m;
    }),
  );
  const activeBriefId = useBriefStore((s) => s.activeBriefId);
  const deleteBrief = useBriefStore((s) => s.deleteBrief);
  const openBriefTab = useTabStore((s) => s.openBriefTab);
  const closeTab = useTabStore((s) => s.closeTab);

  const sortedBriefs = useMemo(
    () =>
      [...briefs].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [briefs],
  );

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
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        description={`確定要刪除「${confirmDelete?.title}」嗎？此操作無法復原。`}
        onConfirm={handleDeleteBrief}
      />

      {briefs.length === 0 ? (
        <div className="px-4 py-3">
          <p className="text-xs text-t3">尚無書狀</p>
        </div>
      ) : (
        <div className="space-y-1 px-3 py-2">
          {sortedBriefs.map((b) => {
            const tabId = `brief:${b.id}`;
            const isActive = activeTabId === tabId;
            const isActiveBrief = activeBriefId === b.id;
            const isDirty = dirtyMap[b.id] ?? false;
            const title = b.title || DEFAULT_BRIEF_LABEL;
            const badge = (b.title?.trim() || DEFAULT_BRIEF_LABEL)[0];
            return (
              <div
                key={b.id}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                  isActive ? 'bg-ac/8' : isActiveBrief ? 'bg-ac/5' : 'hover:bg-bg-2'
                }`}
              >
                <div
                  className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    isActive ? 'bg-ac/15 text-ac' : 'bg-ac/10 text-ac'
                  }`}
                >
                  {badge}
                  {isDirty && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-yl" />
                  )}
                </div>

                <button onClick={() => openBriefTab(b.id, title)} className="min-w-0 flex-1">
                  <p
                    className={`truncate text-left text-sm font-medium ${isActive ? 'text-ac' : 'text-t1'}`}
                  >
                    {b.title || DEFAULT_BRIEF_LABEL}
                  </p>
                  <p className="text-left text-xs text-t3">{formatDate(b.updated_at)}</p>
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
