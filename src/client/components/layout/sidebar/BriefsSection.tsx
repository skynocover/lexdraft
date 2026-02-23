import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useBriefStore } from '../../../stores/useBriefStore';
import { useTabStore } from '../../../stores/useTabStore';
import { ConfirmDialog } from './ConfirmDialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { BRIEF_TYPE_CONFIG, getBriefBadge } from '../../../lib/briefTypeConfig';

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`;
};

export const BriefsSection = ({ activeTabId }: { activeTabId: string | null }) => {
  const briefs = useBriefStore((s) => s.briefs);
  const deleteBrief = useBriefStore((s) => s.deleteBrief);
  const updateBriefType = useBriefStore((s) => s.updateBriefType);
  const openBriefTab = useTabStore((s) => s.openBriefTab);
  const closeTab = useTabStore((s) => s.closeTab);

  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);

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
        <div className="space-y-1 px-3 py-2">
          {[...briefs]
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            .map((b) => {
              const tabId = `brief:${b.id}`;
              const isActive = activeTabId === tabId;
              const title = b.title || b.brief_type;
              const badge = getBriefBadge(b.brief_type);
              return (
                <div
                  key={b.id}
                  className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    isActive ? 'bg-ac/8' : 'hover:bg-bg-2'
                  }`}
                >
                  {/* Badge with Popover */}
                  <Popover
                    open={openPopoverId === b.id}
                    onOpenChange={(open) => setOpenPopoverId(open ? b.id : null)}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
                          isActive ? 'bg-ac/15 text-ac' : 'bg-ac/10 text-ac'
                        }`}
                      >
                        {badge}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-36 p-1" side="bottom" align="start">
                      {Object.entries(BRIEF_TYPE_CONFIG).map(([key, config]) => (
                        <button
                          key={key}
                          onClick={() => {
                            updateBriefType(b.id, key);
                            setOpenPopoverId(null);
                          }}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition hover:bg-bg-2 ${
                            b.brief_type === key ? 'text-ac' : 'text-t1'
                          }`}
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ac/10 text-xs font-bold text-ac">
                            {config.badge}
                          </span>
                          {config.label}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>

                  <button onClick={() => openBriefTab(b.id, title)} className="min-w-0 flex-1">
                    <p
                      className={`truncate text-left text-sm font-medium ${isActive ? 'text-ac' : 'text-t1'}`}
                    >
                      {b.title || '書狀'}
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
