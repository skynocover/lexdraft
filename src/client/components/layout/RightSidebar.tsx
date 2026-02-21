import { FolderOpen, BarChart3, ChevronsRight } from 'lucide-react';
import { useTabStore } from '../../stores/useTabStore';
import { useUIStore, type SidebarTab } from '../../stores/useUIStore';
import { BriefsSection } from './sidebar/BriefsSection';
import { FilesSection } from './sidebar/FilesSection';
import { LawRefsSection } from './sidebar/LawRefsSection';
import { DisputesTab } from '../analysis/DisputesTab';
import { DamagesTab } from '../analysis/DamagesTab';
import { TimelineTab } from '../analysis/TimelineTab';
import { PartiesTab } from '../analysis/PartiesTab';
import { useAnalysisStore } from '../../stores/useAnalysisStore';
import { useBriefStore } from '../../stores/useBriefStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { ChevronRight } from 'lucide-react';

const SIDEBAR_TABS: { key: SidebarTab; label: string; icon: typeof FolderOpen }[] = [
  { key: 'case-materials', label: '案件資料', icon: FolderOpen },
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
        {sidebarTab === 'case-materials' && <CaseMaterialsContent />}
        {sidebarTab === 'analysis' && <AnalysisSidebarContent />}
      </div>
    </div>
  );
};

/* ===================== 案件資料 Tab ===================== */

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

const AnalysisSidebarContent = () => {
  const analysisAccordion = useUIStore((s) => s.analysisAccordion);
  const setAnalysisAccordion = useUIStore((s) => s.setAnalysisAccordion);
  const disputes = useAnalysisStore((s) => s.disputes);
  const damages = useAnalysisStore((s) => s.damages);
  const timeline = useAnalysisStore((s) => s.timeline);

  const totalDamages = damages.reduce((sum, d) => sum + d.amount, 0);

  const disputesBadge = (() => {
    if (disputes.length === 0) return null;
    let miss = 0;
    for (const d of disputes) {
      if (!d.evidence || d.evidence.length === 0) miss++;
    }
    const label = miss > 0 ? `${disputes.length} 個爭點 · ${miss} 缺漏` : `${disputes.length}`;
    return label;
  })();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-2.5">
      <Accordion
        type="multiple"
        value={analysisAccordion}
        onValueChange={setAnalysisAccordion}
        className="flex flex-col gap-2.5"
      >
        <AccordionItem
          value="disputes"
          className="rounded-xl border border-bd/50 bg-bg-1 px-3.5 shadow-lg shadow-black/25 last:border-b"
        >
          <AccordionTrigger className="py-3 text-sm font-medium text-t2 hover:no-underline">
            <div className="flex items-center gap-2">
              <span>爭點分析</span>
              {disputesBadge && (
                <span className="rounded-full bg-bg-3 px-1.5 py-0.5 text-[11px] text-t3">
                  {disputesBadge}
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <DisputesTab />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="damages"
          className="rounded-xl border border-bd/50 bg-bg-1 px-3.5 shadow-lg shadow-black/25 last:border-b"
        >
          <AccordionTrigger className="py-3 text-sm font-medium text-t2 hover:no-underline">
            <div className="flex items-center gap-2">
              <span>金額計算</span>
              {totalDamages > 0 && (
                <span className="rounded-full bg-bg-3 px-1.5 py-0.5 text-[11px] text-t3">
                  NT$ {totalDamages.toLocaleString()}
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <DamagesTab />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="timeline"
          className="rounded-xl border border-bd/50 bg-bg-1 px-3.5 shadow-lg shadow-black/25 last:border-b"
        >
          <AccordionTrigger className="py-3 text-sm font-medium text-t2 hover:no-underline">
            <div className="flex items-center gap-2">
              <span>時間軸</span>
              {timeline.length > 0 && (
                <span className="rounded-full bg-bg-3 px-1.5 py-0.5 text-[11px] text-t3">
                  {timeline.length}
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <TimelineTab />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="parties"
          className="rounded-xl border border-bd/50 bg-bg-1 px-3.5 shadow-lg shadow-black/25 last:border-b"
        >
          <AccordionTrigger className="py-3 text-sm font-medium text-t2 hover:no-underline">
            當事人
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <PartiesTab />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};
