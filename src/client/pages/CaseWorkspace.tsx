import { Fragment, useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { PanelLeft, PanelRight } from 'lucide-react';
import {
  Group as PanelGroup,
  Panel as ResizablePanel,
  Separator as PanelResizeHandle,
} from 'react-resizable-panels';
import { toast } from 'sonner';
import { useCaseStore, type Case, type CaseFile } from '../stores/useCaseStore';
import { useBriefStore } from '../stores/useBriefStore';
import { useAnalysisStore } from '../stores/useAnalysisStore';
import { useChatStore } from '../stores/useChatStore';
import { useTabStore } from '../stores/useTabStore';
import { api } from '../lib/api';
import { Header } from '../components/layout/Header';
import { StatusBar } from '../components/layout/StatusBar';
import { ChatPanel } from '../components/layout/ChatPanel';
import { RightSidebar } from '../components/layout/RightSidebar';
import { EditorPanel } from '../components/editor/EditorPanel';
import { useUIStore } from '../stores/useUIStore';

export function CaseWorkspace() {
  const { caseId } = useParams();
  const setCurrentCase = useCaseStore((s) => s.setCurrentCase);
  const setFiles = useCaseStore((s) => s.setFiles);
  const files = useCaseStore((s) => s.files);
  const setCurrentBrief = useBriefStore((s) => s.setCurrentBrief);
  const loadBriefs = useBriefStore((s) => s.loadBriefs);
  const loadLawRefs = useBriefStore((s) => s.loadLawRefs);
  const loadDisputes = useAnalysisStore((s) => s.loadDisputes);
  const loadDamages = useAnalysisStore((s) => s.loadDamages);
  const loadTimeline = useAnalysisStore((s) => s.loadTimeline);
  const loadParties = useAnalysisStore((s) => s.loadParties);
  const loadClaims = useAnalysisStore((s) => s.loadClaims);
  const panels = useTabStore((s) => s.panels);
  const openBriefTab = useTabStore((s) => s.openBriefTab);
  const openFileTab = useTabStore((s) => s.openFileTab);
  const clearTabs = useTabStore((s) => s.clearTabs);
  const reorderTab = useTabStore((s) => s.reorderTab);
  const moveTab = useTabStore((s) => s.moveTab);
  const leftSidebarOpen = useUIStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const pollingRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const initialTabRef = useRef(new URLSearchParams(window.location.search).get('tab'));

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeData = active.data.current as { panelId: string; tabId: string } | undefined;
    const overData = over.data.current as { panelId: string; tabId: string } | undefined;

    if (!activeData || !overData) return;

    if (activeData.panelId === overData.panelId) {
      // Reorder within same panel
      const panel = panels.find((p) => p.id === activeData.panelId);
      if (!panel) return;
      const fromIndex = panel.tabIds.indexOf(activeData.tabId);
      const toIndex = panel.tabIds.indexOf(overData.tabId);
      if (fromIndex !== -1 && toIndex !== -1) {
        reorderTab(activeData.panelId, fromIndex, toIndex);
      }
    } else {
      // Move between panels
      const toPanel = panels.find((p) => p.id === overData.panelId);
      if (!toPanel) return;
      const toIndex = toPanel.tabIds.indexOf(overData.tabId);
      moveTab(activeData.tabId, activeData.panelId, overData.panelId, toIndex);
    }
  };

  useEffect(() => {
    if (!caseId) return;

    let cancelled = false;

    // 從 ref 讀取初始 URL 參數（ref 在 render 階段就捕獲，不受 Strict Mode cleanup 影響）
    const tabParam = initialTabRef.current;

    // 載入案件資料
    api.get<Case>(`/cases/${caseId}`).then(setCurrentCase).catch(console.error);

    // 載入檔案列表
    const filesPromise = api
      .get<CaseFile[]>(`/cases/${caseId}/files`)
      .then((data) => {
        setFiles(data);
        return data;
      })
      .catch((err) => {
        console.error(err);
        return [] as CaseFile[];
      });

    // 載入聊天歷史
    useChatStore.getState().loadHistory(caseId);

    // 載入書狀列表 + 從 URL 恢復 tab
    const briefsPromise = loadBriefs(caseId).then(() => useBriefStore.getState().briefs);

    Promise.all([briefsPromise, filesPromise]).then(([briefs, loadedFiles]) => {
      if (cancelled) return;

      // 用完即清，避免 caseId 變更時重複使用舊值
      initialTabRef.current = null;

      if (tabParam) {
        const colonIdx = tabParam.indexOf(':');
        const type = tabParam.slice(0, colonIdx);
        const id = tabParam.slice(colonIdx + 1);

        if (type === 'brief' && id) {
          const brief = briefs.find((b) => b.id === id);
          if (brief) {
            openBriefTab(brief.id, brief.title || brief.brief_type);
            return;
          }
          toast.error('該書狀已不存在');
        } else if (type === 'file' && id) {
          const file = loadedFiles.find((f) => f.id === id);
          if (file) {
            openFileTab(file.id, file.filename);
            return;
          }
          toast.error('該檔案已不存在');
        }

        // 清除無效的 tab 參數
        const url = new URL(window.location.href);
        url.searchParams.delete('tab');
        window.history.replaceState(null, '', url.toString());
      }

      // fallback: 開啟第一個書狀
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

    // 載入主張圖譜
    loadClaims(caseId);

    return () => {
      cancelled = true;
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
    const hasPending = files.some((f) => f.status === 'pending' || f.status === 'processing');

    if (hasPending && caseId) {
      pollingRef.current = setInterval(() => {
        api.get<CaseFile[]>(`/cases/${caseId}/files`).then(setFiles).catch(console.error);
      }, 3000);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [files, caseId]);

  // 同步 active tab 到 URL search params
  useEffect(() => {
    const unsub = useTabStore.subscribe((state, prevState) => {
      const panel = state.panels.find((p) => p.id === state.focusedPanelId);
      const activeTabId = panel?.activeTabId ?? null;

      const prevPanel = prevState.panels.find((p) => p.id === prevState.focusedPanelId);
      if (activeTabId === (prevPanel?.activeTabId ?? null)) return;

      const url = new URL(window.location.href);
      if (activeTabId?.startsWith('brief:') || activeTabId?.startsWith('file:')) {
        url.searchParams.set('tab', activeTabId);
      } else {
        url.searchParams.delete('tab');
      }
      window.history.replaceState(null, '', url.toString());
    });

    return unsub;
  }, []);

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      <Header />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left sidebar: ChatPanel + StatusBar */}
        {leftSidebarOpen ? (
          <div className="flex min-h-0 shrink-0 flex-col">
            <ChatPanel />
            <StatusBar />
          </div>
        ) : (
          <SidebarStrip side="left" onClick={toggleLeftSidebar} />
        )}

        {/* Center: Editor — full height, no bottom panel */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-0">
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <PanelGroup orientation="horizontal">
                {panels.map((panel, i) => (
                  <Fragment key={panel.id}>
                    {i > 0 && (
                      <PanelResizeHandle className="w-1 bg-bg-3 transition-colors hover:bg-ac cursor-col-resize" />
                    )}
                    <ResizablePanel minSize={20}>
                      <EditorPanel panelId={panel.id} />
                    </ResizablePanel>
                  </Fragment>
                ))}
              </PanelGroup>
            </div>
          </DndContext>
        </main>

        {/* Right sidebar: 2-tab sidebar */}
        {sidebarOpen ? (
          <RightSidebar />
        ) : (
          <SidebarStrip side="right" onClick={() => useUIStore.getState().setSidebarOpen(true)} />
        )}
      </div>
    </div>
  );
}

const SidebarStrip = ({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) => {
  const isLeft = side === 'left';
  const Icon = isLeft ? PanelLeft : PanelRight;
  const label = isLeft ? 'AI 助理' : '側邊欄';
  return (
    <div
      className={`flex w-10 shrink-0 flex-col items-center border-bd bg-bg-1 ${
        isLeft ? 'border-r' : 'border-l'
      }`}
    >
      <button
        onClick={onClick}
        className="mt-2 rounded p-1.5 text-t3 transition hover:bg-bg-h hover:text-t1"
        title={isLeft ? '展開 AI 助理' : '展開側邊欄'}
      >
        <Icon size={16} />
      </button>
      <span className="mt-3 text-[11px] text-t3" style={{ writingMode: 'vertical-lr' }}>
        {label}
      </span>
    </div>
  );
};
