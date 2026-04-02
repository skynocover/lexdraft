import { useCallback, useState } from 'react';
import { FileText, Scale, ScrollText } from 'lucide-react';
import { useBriefStore } from '../../stores/useBriefStore';
import { useTabStore } from '../../stores/useTabStore';
import { TabBar } from '../layout/TabBar';
import { A4PageEditor } from './tiptap/A4PageEditor';
import { FileViewer } from './FileViewer';
import { OutlinePanel } from './OutlinePanel';
import { VersionPreviewEditor } from './VersionPreviewEditor';
import { LawViewer } from './LawViewer';
import { LawSearchViewer } from './LawSearchViewer';
import { TemplateEditor } from './TemplateEditor';
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
          <A4PageEditor briefId={activeTab.briefId} />
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
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <p className="text-sm text-t2">從右側面板選擇內容</p>
            <div className="space-y-2.5 text-xs text-t3">
              <div className="flex items-center gap-2">
                <ScrollText size={14} className="shrink-0 text-ac" />
                <span>書狀草稿 — 在「卷宗」tab</span>
              </div>
              <div className="flex items-center gap-2">
                <FileText size={14} className="shrink-0 text-ac" />
                <span>案件文件 — 在「卷宗」tab</span>
              </div>
              <div className="flex items-center gap-2">
                <Scale size={14} className="shrink-0 text-ac" />
                <span>法條全文 — 點擊書狀中的法條引用</span>
              </div>
            </div>
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
