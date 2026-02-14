import { useEffect, useRef } from "react";
import { useParams } from "react-router";
import { useCaseStore, type Case, type CaseFile } from "../stores/useCaseStore";
import { useBriefStore } from "../stores/useBriefStore";
import { useAnalysisStore } from "../stores/useAnalysisStore";
import { useChatStore } from "../stores/useChatStore";
import { useTabStore } from "../stores/useTabStore";
import { api } from "../lib/api";
import { Header } from "../components/layout/Header";
import { StatusBar } from "../components/layout/StatusBar";
import { ChatPanel } from "../components/layout/ChatPanel";
import { RightSidebar } from "../components/layout/RightSidebar";
import { TabBar } from "../components/layout/TabBar";
import { BriefEditor } from "../components/editor";
import { FileViewer } from "../components/editor/FileViewer";
import { AnalysisPanel } from "../components/analysis/AnalysisPanel";

export function CaseWorkspace() {
  const { caseId } = useParams();
  const setCurrentCase = useCaseStore((s) => s.setCurrentCase);
  const setFiles = useCaseStore((s) => s.setFiles);
  const files = useCaseStore((s) => s.files);
  const currentBrief = useBriefStore((s) => s.currentBrief);
  const setCurrentBrief = useBriefStore((s) => s.setCurrentBrief);
  const loadBriefs = useBriefStore((s) => s.loadBriefs);
  const loadLawRefs = useBriefStore((s) => s.loadLawRefs);
  const loadDisputes = useAnalysisStore((s) => s.loadDisputes);
  const loadDamages = useAnalysisStore((s) => s.loadDamages);
  const loadTimeline = useAnalysisStore((s) => s.loadTimeline);
  const loadParties = useAnalysisStore((s) => s.loadParties);
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const openBriefTab = useTabStore((s) => s.openBriefTab);
  const clearTabs = useTabStore((s) => s.clearTabs);
  const pollingRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  useEffect(() => {
    if (!caseId) return;

    // 載入案件資料
    api.get<Case>(`/cases/${caseId}`).then(setCurrentCase).catch(console.error);

    // 載入檔案列表
    api
      .get<CaseFile[]>(`/cases/${caseId}/files`)
      .then(setFiles)
      .catch(console.error);

    // 載入聊天歷史
    useChatStore.getState().loadHistory(caseId);

    // 載入書狀列表，如有書狀則開啟第一個 tab
    loadBriefs(caseId).then(() => {
      const briefs = useBriefStore.getState().briefs;
      if (briefs.length > 0) {
        openBriefTab(briefs[0].id, briefs[0].title || briefs[0].brief_type);
      }
    });

    // 載入爭點
    loadDisputes(caseId);

    // 載入金額
    loadDamages(caseId);

    // 載入法條引用
    loadLawRefs(caseId);

    // 載入時間軸
    loadTimeline(caseId);

    // 載入當事人
    loadParties(caseId);

    return () => {
      setCurrentCase(null);
      setCurrentBrief(null);
      setFiles([]);
      clearTabs();
      useChatStore.getState().clearMessages();
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [caseId]);

  // Polling: 如果有 pending/processing 檔案，每 3 秒刷新
  useEffect(() => {
    const hasPending = files.some(
      (f) => f.status === "pending" || f.status === "processing",
    );

    if (hasPending && caseId) {
      pollingRef.current = setInterval(() => {
        api
          .get<CaseFile[]>(`/cases/${caseId}/files`)
          .then(setFiles)
          .catch(console.error);
      }, 3000);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [files, caseId]);

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        <ChatPanel />

        <main className="flex flex-1 flex-col overflow-hidden bg-bg-0">
          <TabBar />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Editor / FileViewer — takes remaining space */}
            <div className="relative min-h-0 flex-1 flex flex-col overflow-hidden">
              {activeTab?.data.type === "brief" ? (
                <BriefEditor
                  content={currentBrief?.content_structured ?? null}
                />
              ) : activeTab?.data.type === "file" ? (
                <FileViewer
                  filename={activeTab.data.filename}
                  pdfUrl={activeTab.data.pdfUrl}
                  loading={activeTab.data.loading}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-t3">請從右側面板選擇書狀或檔案</p>
                </div>
              )}
            </div>
            {/* Analysis Panel — shrink-0, below editor */}
            <AnalysisPanel />
          </div>
        </main>

        <RightSidebar />
      </div>

      <StatusBar />
    </div>
  );
}
