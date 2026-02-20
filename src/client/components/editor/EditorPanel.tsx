import { useCallback, useState } from 'react';
import { useBriefStore } from '../../stores/useBriefStore';
import { useTabStore } from '../../stores/useTabStore';
import { TabBar } from '../layout/TabBar';
import { BriefEditor } from './index';
import { FileViewer } from './FileViewer';
import { OutlinePanel } from './OutlinePanel';
import { VersionPreviewEditor } from './VersionPreviewEditor';
import { LawViewer } from './LawViewer';

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
  const currentBrief = useBriefStore((s) => s.currentBrief);
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
        {activeTab?.type === 'brief' ? (
          <BriefEditor content={currentBrief?.content_structured ?? null} />
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
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-t3">請從右側面板選擇書狀或檔案</p>
          </div>
        )}
      </div>

      {/* Confirm restore dialog */}
      {confirmRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-72 rounded-lg border border-bd bg-bg-1 p-4 shadow-xl">
            <p className="mb-4 text-sm text-t1">確定還原到此版本？目前的內容將被覆蓋。</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmRestore(null)}
                className="rounded border border-bd px-3 py-1 text-xs text-t2 transition hover:bg-bg-h"
              >
                取消
              </button>
              <button
                onClick={() => handleRestore(confirmRestore.versionId, confirmRestore.tabId)}
                className="rounded bg-ac px-3 py-1 text-xs text-bg-0 transition hover:opacity-90"
              >
                還原
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
