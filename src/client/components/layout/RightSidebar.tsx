import { Info, FolderOpen, BarChart3, ChevronsRight, ChevronRight } from 'lucide-react';
import { useTabStore } from '../../stores/useTabStore';
import { useUIStore, type SidebarTab, type AnalysisSubTab } from '../../stores/useUIStore';
import { BriefsSection } from './sidebar/BriefsSection';
import { FilesSection } from './sidebar/FilesSection';
import { LawRefsSection } from './sidebar/LawRefsSection';
import { CaseInfoTab } from './sidebar/CaseInfoTab';
import { DisputesTab } from '../analysis/DisputesTab';
import { DamagesTab } from '../analysis/DamagesTab';
import { TimelineTab } from '../analysis/TimelineTab';
import { useAnalysisStore } from '../../stores/useAnalysisStore';
import { useBriefStore } from '../../stores/useBriefStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';

const SIDEBAR_TABS: { key: SidebarTab; label: string; icon: typeof FolderOpen }[] = [
  { key: 'case-info', label: '案件資訊', icon: Info },
  { key: 'case-materials', label: '卷宗檔案', icon: FolderOpen },
  { key: 'analysis', label: '分析', icon: BarChart3 },
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
        {sidebarTab === 'case-materials' && <CaseMaterialsContent />}
        {sidebarTab === 'analysis' && <AnalysisSidebarContent />}
      </div>
    </div>
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
  const lawRefs = useBriefStore((s) => s.lawRefs);

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
      >
        <FilesSection />
      </CollapsibleSection>

      {/* 法條引用 */}
      <CollapsibleSection
        title="法條引用"
        count={lawRefs.length}
        open={caseMaterialSections.lawRefs}
        onOpenChange={(open) => setCaseMaterialSection('lawRefs', open)}
      >
        <LawRefsSection />
      </CollapsibleSection>
    </div>
  );
};

/* ===================== Collapsible Section Wrapper ===================== */

const CollapsibleSection = ({
  title,
  count,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) => {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 border-b border-bd px-4 py-2.5 text-xs font-medium text-t2 transition hover:bg-bg-h">
        <ChevronRight
          size={14}
          className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        />
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-bg-3 px-1.5 py-0.5 text-[10px] text-t3">{count}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
};

/* ===================== 分析 Tab ===================== */

const ANALYSIS_SUB_TABS: { key: AnalysisSubTab; label: string }[] = [
  { key: 'disputes', label: '爭點' },
  { key: 'damages', label: '金額' },
  { key: 'timeline', label: '時間軸' },
];

const AnalysisSidebarContent = () => {
  const analysisSubTab = useUIStore((s) => s.analysisSubTab);
  const setAnalysisSubTab = useUIStore((s) => s.setAnalysisSubTab);
  const disputes = useAnalysisStore((s) => s.disputes);
  const damages = useAnalysisStore((s) => s.damages);
  const timeline = useAnalysisStore((s) => s.timeline);

  const totalDamages = damages.reduce((sum, d) => sum + d.amount, 0);

  const getBadge = (key: AnalysisSubTab): string | null => {
    switch (key) {
      case 'disputes': {
        if (disputes.length === 0) return null;
        let miss = 0;
        for (const d of disputes) {
          if (!d.evidence || d.evidence.length === 0) miss++;
        }
        return miss > 0 ? `${disputes.length} · ${miss} 缺漏` : `${disputes.length}`;
      }
      case 'damages':
        return totalDamages > 0 ? `NT$ ${totalDamages.toLocaleString()}` : null;
      case 'timeline':
        return timeline.length > 0 ? `${timeline.length}` : null;
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sub-tab pills */}
      <div className="sticky top-0 z-10 flex gap-1 border-b border-bd bg-bg-0 px-2.5 py-2">
        {ANALYSIS_SUB_TABS.map((tab) => {
          const isActive = analysisSubTab === tab.key;
          const badge = getBadge(tab.key);
          return (
            <button
              key={tab.key}
              onClick={() => setAnalysisSubTab(tab.key)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                isActive ? 'bg-ac/15 text-ac' : 'text-t3 hover:bg-bg-h hover:text-t1'
              }`}
            >
              <span>{tab.label}</span>
              {badge && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    isActive ? 'bg-ac/10 text-ac' : 'bg-bg-3 text-t3'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {analysisSubTab === 'disputes' && <DisputesTab />}
        {analysisSubTab === 'damages' && <DamagesTab />}
        {analysisSubTab === 'timeline' && <TimelineTab />}
      </div>
    </div>
  );
};
