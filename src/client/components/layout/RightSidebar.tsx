import { ChevronsRight } from 'lucide-react';
import { useTabStore } from '../../stores/useTabStore';
import { useUIStore } from '../../stores/useUIStore';
import { BriefsSection } from './sidebar/BriefsSection';
import { FilesSection } from './sidebar/FilesSection';
import { LawRefsSection } from './sidebar/LawRefsSection';

export function RightSidebar() {
  const panels = useTabStore((s) => s.panels);
  const focusedPanelId = useTabStore((s) => s.focusedPanelId);
  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);

  const focusedPanel = panels.find((p) => p.id === focusedPanelId);
  const activeTabId = focusedPanel?.activeTabId ?? null;

  return (
    <aside className="theme-light flex w-80 min-h-0 shrink-0 flex-col border-l border-bd bg-bg-0 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-bd px-4 py-3">
        <span className="text-base font-bold text-t1">案件資料</span>
        <button
          onClick={toggleRightSidebar}
          className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
          title="收合側邊欄"
        >
          <ChevronsRight size={16} />
        </button>
      </div>

      <BriefsSection activeTabId={activeTabId} />
      <FilesSection />
      <LawRefsSection />
    </aside>
  );
}
