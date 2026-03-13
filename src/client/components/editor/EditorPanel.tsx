import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import { useBriefStore } from '../../stores/useBriefStore';
import { useTabStore } from '../../stores/useTabStore';
import { useCitedLawRefs } from '../../hooks/useCitedLawRefs';
import { TabBar } from '../layout/TabBar';
import { A4PageEditor } from './tiptap/A4PageEditor';
import { FileViewer } from './FileViewer';
import { OutlinePanel } from './OutlinePanel';
import { VersionPreviewEditor } from './VersionPreviewEditor';
import { LawViewer } from './LawViewer';
import { LawSearchViewer } from './LawSearchViewer';
import { TemplateEditor } from './TemplateEditor';
import { CollapsibleSection } from '../layout/sidebar/CollapsibleSection';
import { LawRefsSection } from '../layout/sidebar/LawRefsSection';
import { ConfirmDialog } from '../ui/confirm-dialog';

interface EditorPanelProps {
  panelId: string;
}

export const EditorPanel = ({ panelId }: EditorPanelProps) => {
  const panel = useTabStore((s) => s.panels.find((p) => p.id === panelId));
  const tabRegistry = useTabStore((s) => s.tabRegistry);
  const focusedPanelId = useTabStore((s) => s.focusedPanelId);
  const focusPanel = useTabStore((s) => s.focusPanel);
  const setFileHighlight = useTabStore((s) => s.setFileHighlight);
  const closeTab = useTabStore((s) => s.closeTab);
  const restoreVersion = useBriefStore((s) => s.restoreVersion);

  const [confirmRestore, setConfirmRestore] = useState<{
    versionId: string;
    tabId: string;
  } | null>(null);

  const isFocused = focusedPanelId === panelId;
  const activeTabId = panel?.activeTabId ?? null;
  const activeTab = activeTabId ? tabRegistry[activeTabId] : null;

  const handlePanelClick = () => {
    if (!isFocused) {
      focusPanel(panelId);
    }
  };

  const handleClearHighlight = useCallback(() => {
    if (activeTab?.type === 'file') {
      setFileHighlight(activeTab.fileId, null);
    }
  }, [activeTab, setFileHighlight]);

  const handleRestore = useCallback(
    async (versionId: string, tabId: string) => {
      await restoreVersion(versionId);
      closeTab(tabId, panelId);
      setConfirmRestore(null);
    },
    [restoreVersion, closeTab, panelId],
  );

  return (
    <div
      className={`flex h-full flex-col overflow-hidden ${
        isFocused ? 'ring-1 ring-ac/30 ring-inset' : ''
      }`}
      onMouseDown={handlePanelClick}
    >
      <TabBar panelId={panelId} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab?.type === 'brief' && isFocused && <OutlinePanel />}
        {activeTab?.type === 'template' ? (
          <TemplateEditor />
        ) : activeTab?.type === 'brief' ? (
          <>
            <A4PageEditor briefId={activeTab.briefId} />
            <LawRefsPanelGuard />
          </>
        ) : activeTab?.type === 'file' ? (
          <FileViewer
            filename={activeTab.filename}
            pdfUrl={activeTab.pdfUrl}
            loading={activeTab.loading}
            highlightText={activeTab.highlightText}
            onClearHighlight={handleClearHighlight}
          />
        ) : activeTab?.type === 'version-preview' && activeTabId ? (
          <VersionPreviewEditor
            content={activeTab.content}
            briefTitle={activeTab.briefTitle}
            label={activeTab.label}
            loading={activeTab.loading}
            onRestore={() =>
              setConfirmRestore({
                versionId: activeTab.versionId,
                tabId: activeTabId,
              })
            }
          />
        ) : activeTab?.type === 'law' ? (
          <LawViewer
            lawRefId={activeTab.lawRefId}
            lawName={activeTab.lawName}
            article={activeTab.article}
            fullText={activeTab.fullText}
          />
        ) : activeTab?.type === 'law-search' ? (
          <LawSearchViewer
            key={activeTab.searchId}
            searchId={activeTab.searchId}
            initialQuery={activeTab.query}
            cachedResults={activeTab.cachedResults}
            cachedSelected={activeTab.cachedSelected}
            autoSearch={activeTab.autoSearch}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-t3">請從右側面板選擇書狀或檔案</p>
          </div>
        )}
      </div>

      {/* Confirm restore dialog */}
      <ConfirmDialog
        open={!!confirmRestore}
        onOpenChange={(open) => !open && setConfirmRestore(null)}
        description="確定還原到此版本？目前的內容將被覆蓋。"
        confirmLabel="還原"
        variant="primary"
        onConfirm={() =>
          confirmRestore && handleRestore(confirmRestore.versionId, confirmRestore.tabId)
        }
      />
    </div>
  );
};

/* ===================== 法條引用 Panel ===================== */

const LawRefsPanelGuard = () => {
  const hasLawRefs = useBriefStore((s) => s.lawRefs.length > 0);
  if (!hasLawRefs) return null;
  return <LawRefsPanel />;
};

const LawRefsPanel = () => {
  const [open, setOpen] = useState(true);
  const openLawSearchTab = useTabStore((s) => s.openLawSearchTab);
  const { citedLawRefs, availableLawRefs, citedCount } = useCitedLawRefs();

  return (
    <CollapsibleSection
      title="法條引用"
      count={citedCount}
      open={open}
      onOpenChange={setOpen}
      className="shrink-0 border-t border-bd"
      action={
        <button
          onClick={() => openLawSearchTab()}
          className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
          title="搜尋法條"
        >
          <Search size={14} />
        </button>
      }
    >
      <div className="max-h-48 overflow-y-auto">
        <LawRefsSection citedLawRefs={citedLawRefs} availableLawRefs={availableLawRefs} />
      </div>
    </CollapsibleSection>
  );
};
