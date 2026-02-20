import { useSortable, SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Columns2 } from 'lucide-react';
import { useTabStore, type TabData } from '../../stores/useTabStore';

interface TabBarProps {
  panelId: string;
}

const SortableTab = ({
  tabId,
  tabData,
  isActive,
  panelId,
}: {
  tabId: string;
  tabData: TabData;
  isActive: boolean;
  panelId: string;
}) => {
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabId,
    data: { panelId, tabId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isBrief = tabData.type === 'brief';
  const isVersion = tabData.type === 'version-preview';
  const isLaw = tabData.type === 'law';
  const label =
    tabData.type === 'brief'
      ? tabData.title || '書狀'
      : tabData.type === 'version-preview'
        ? tabData.label
        : tabData.type === 'law'
          ? `${tabData.lawName} ${tabData.article}`
          : tabData.filename;

  const badgeClass = isBrief
    ? 'bg-ac/20 text-ac'
    : isVersion
      ? 'bg-pp/20 text-pp'
      : isLaw
        ? 'bg-pu/20 text-pu'
        : 'bg-rd/20 text-rd';
  const badgeText = isBrief ? 'DOC' : isVersion ? 'VER' : isLaw ? 'LAW' : 'PDF';

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => setActiveTab(tabId, panelId)}
      className={`group flex h-full max-w-45 items-center gap-1.5 border-r border-bd px-3 text-[13px] transition ${
        isActive ? 'border-b-2 border-b-ac bg-bg-0 text-t1' : 'text-t3 hover:bg-bg-h hover:text-t2'
      }`}
    >
      <span className={`shrink-0 rounded px-1 py-0.5 text-[11px] font-semibold ${badgeClass}`}>
        {badgeText}
      </span>
      <span className="truncate">{label}</span>
      <span
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tabId, panelId);
        }}
        className="ml-1 shrink-0 rounded p-0.5 text-t3 opacity-0 transition hover:bg-bg-3 hover:text-t1 group-hover:opacity-100"
      >
        ✕
      </span>
    </button>
  );
};

export const TabBar = ({ panelId }: TabBarProps) => {
  const panel = useTabStore((s) => s.panels.find((p) => p.id === panelId));
  const tabRegistry = useTabStore((s) => s.tabRegistry);
  const splitPanel = useTabStore((s) => s.splitPanel);

  if (!panel || panel.tabIds.length === 0) return null;

  return (
    <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-bd bg-bg-2">
      <SortableContext items={panel.tabIds} strategy={horizontalListSortingStrategy}>
        {panel.tabIds.map((tabId) => {
          const tabData = tabRegistry[tabId];
          if (!tabData) return null;
          return (
            <SortableTab
              key={tabId}
              tabId={tabId}
              tabData={tabData}
              isActive={tabId === panel.activeTabId}
              panelId={panelId}
            />
          );
        })}
      </SortableContext>
      {/* Split Right button */}
      {panel.activeTabId && (
        <button
          onClick={() => {
            if (panel.activeTabId) {
              splitPanel(panel.activeTabId, panelId);
            }
          }}
          className="ml-auto shrink-0 px-2 py-1.5 text-t3 transition hover:bg-bg-h hover:text-t1"
          title="分割面板"
        >
          <Columns2 size={14} />
        </button>
      )}
    </div>
  );
};
