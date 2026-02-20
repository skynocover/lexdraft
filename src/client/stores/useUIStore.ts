import { create } from 'zustand';

type AnalysisTab = 'disputes' | 'damages' | 'timeline' | 'evidence' | 'parties' | 'claims';

interface UIState {
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  bottomPanelTab: AnalysisTab;
  rightFilesOpen: boolean;
  rightLawRefsOpen: boolean;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  toggleBottomPanel: () => void;
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelHeight: (height: number) => void;
  setBottomPanelTab: (tab: AnalysisTab) => void;
  toggleRightFiles: () => void;
  toggleRightLawRefs: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  bottomPanelOpen: false,
  bottomPanelHeight: 200,
  bottomPanelTab: 'disputes',
  rightFilesOpen: true,
  rightLawRefsOpen: true,
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
  setBottomPanelHeight: (height) =>
    set({ bottomPanelHeight: Math.min(500, Math.max(100, height)) }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
  toggleRightFiles: () => set((s) => ({ rightFilesOpen: !s.rightFilesOpen })),
  toggleRightLawRefs: () => set((s) => ({ rightLawRefsOpen: !s.rightLawRefsOpen })),
  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
}));
