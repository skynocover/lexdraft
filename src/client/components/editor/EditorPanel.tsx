import { useBriefStore } from "../../stores/useBriefStore";
import { useTabStore } from "../../stores/useTabStore";
import { TabBar } from "../layout/TabBar";
import { BriefEditor } from "./index";
import { FileViewer } from "./FileViewer";
import { OutlinePanel } from "./OutlinePanel";

interface EditorPanelProps {
  panelId: string;
}

export const EditorPanel = ({ panelId }: EditorPanelProps) => {
  const panel = useTabStore((s) => s.panels.find((p) => p.id === panelId));
  const tabRegistry = useTabStore((s) => s.tabRegistry);
  const focusedPanelId = useTabStore((s) => s.focusedPanelId);
  const focusPanel = useTabStore((s) => s.focusPanel);
  const currentBrief = useBriefStore((s) => s.currentBrief);

  const isFocused = focusedPanelId === panelId;
  const activeTabId = panel?.activeTabId ?? null;
  const activeTab = activeTabId ? tabRegistry[activeTabId] : null;

  const handlePanelClick = () => {
    if (!isFocused) {
      focusPanel(panelId);
    }
  };

  return (
    <div
      className={`flex h-full flex-col overflow-hidden ${
        isFocused ? "ring-1 ring-ac/30 ring-inset" : ""
      }`}
      onMouseDown={handlePanelClick}
    >
      <TabBar panelId={panelId} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab?.type === "brief" && isFocused && <OutlinePanel />}
        {activeTab?.type === "brief" ? (
          <BriefEditor
            content={
              isFocused ? (currentBrief?.content_structured ?? null) : null
            }
          />
        ) : activeTab?.type === "file" ? (
          <FileViewer
            filename={activeTab.filename}
            pdfUrl={activeTab.pdfUrl}
            loading={activeTab.loading}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-t3">請從右側面板選擇書狀或檔案</p>
          </div>
        )}
      </div>
    </div>
  );
};
