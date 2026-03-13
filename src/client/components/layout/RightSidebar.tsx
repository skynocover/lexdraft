import { Info, FolderOpen, Swords, Clock, ChevronsRight, Plus } from 'lucide-react';
import { TooltipProvider } from '../ui/tooltip';
import { useTabStore } from '../../stores/useTabStore';
import { useUIStore, type SidebarTab } from '../../stores/useUIStore';
import { BriefsSection } from './sidebar/BriefsSection';
import { CollapsibleSection } from './sidebar/CollapsibleSection';
import { FilesSection } from './sidebar/FilesSection';
import { CaseInfoTab } from './sidebar/CaseInfoTab';
import { DisputesTab } from '../analysis/DisputesTab';
import { TimelineTab } from '../analysis/TimelineTab';
import { useAnalysisStore } from '../../stores/useAnalysisStore';
import { useBriefStore } from '../../stores/useBriefStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { useFileUpload } from '../../hooks/useFileUpload';

const SIDEBAR_TABS: { key: SidebarTab; label: string; icon: typeof FolderOpen }[] = [
  { key: 'disputes', label: '爭點', icon: Swords },
  { key: 'case-materials', label: '卷宗', icon: FolderOpen },
  { key: 'timeline', label: '時間軸', icon: Clock },
  { key: 'case-info', label: '案件', icon: Info },
];

export const RightSidebar = () => {
  const sidebarTab = useUIStore((s) => s.sidebarTab);
  const setSidebarTab = useUIStore((s) => s.setSidebarTab);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  return (
    <div className="flex min-h-0 w-88 shrink-0 flex-col overflow-hidden border-l border-bd bg-bg-0">
      {/* Top tab bar */}
      <div className="flex items-center border-b border-bd px-1">
        {SIDEBAR_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = sidebarTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSidebarTab(tab.key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition ${
                isActive ? 'border-ac text-ac' : 'border-transparent text-t3 hover:text-t1'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => setSidebarOpen(false)}
          className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
          title="收合側邊欄"
        >
          <ChevronsRight size={14} />
        </button>
      </div>

      {/* Content area */}
      <div
        key={sidebarTab}
        className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-150"
      >
        {sidebarTab === 'case-info' && <CaseInfoTab />}
        {sidebarTab === 'disputes' && (
          <TooltipProvider delayDuration={300}>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5">
              <DisputesTab />
            </div>
          </TooltipProvider>
        )}
        {sidebarTab === 'case-materials' && <CaseMaterialsContent />}
        {sidebarTab === 'timeline' && <TimelineContent />}
      </div>
    </div>
  );
};

/* ===================== 時間軸 Tab ===================== */

const TimelineContent = () => {
  const timelineCount = useAnalysisStore((s) => s.timeline.length);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5">
        {timelineCount > 0 && (
          <div className="mb-2 flex items-center text-xs text-t3">
            <span>{timelineCount} 個事件</span>
          </div>
        )}
        <TimelineTab />
      </div>
    </TooltipProvider>
  );
};

/* ===================== 卷宗檔案 Tab ===================== */

const CaseMaterialsContent = () => {
  const panels = useTabStore((s) => s.panels);
  const focusedPanelId = useTabStore((s) => s.focusedPanelId);
  const caseMaterialSections = useUIStore((s) => s.caseMaterialSections);
  const setCaseMaterialSection = useUIStore((s) => s.setCaseMaterialSection);
  const briefs = useBriefStore((s) => s.briefs);
  const files = useCaseStore((s) => s.files);

  const focusedPanel = panels.find((p) => p.id === focusedPanelId);
  const activeTabId = focusedPanel?.activeTabId ?? null;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* 書狀草稿 */}
      <CollapsibleSection
        title="書狀草稿"
        count={briefs.length}
        open={caseMaterialSections.briefs}
        onOpenChange={(open) => setCaseMaterialSection('briefs', open)}
      >
        <BriefsSection activeTabId={activeTabId} />
      </CollapsibleSection>

      {/* 案件卷宗 */}
      <CollapsibleSection
        title="案件卷宗"
        count={files.length}
        open={caseMaterialSections.files}
        onOpenChange={(open) => setCaseMaterialSection('files', open)}
        action={<FileUploadButton />}
      >
        <FilesSection />
      </CollapsibleSection>
    </div>
  );
};

/* ===================== File Upload Button ===================== */

const FileUploadButton = () => {
  const { fileInputRef, uploading, handleUpload, triggerFileSelect } = useFileUpload();

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        onChange={handleUpload}
        className="hidden"
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          triggerFileSelect();
        }}
        disabled={uploading}
        className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-ac disabled:opacity-50"
        title="上傳檔案"
      >
        {uploading ? (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-ac border-t-transparent" />
        ) : (
          <Plus size={16} />
        )}
      </button>
    </>
  );
};
