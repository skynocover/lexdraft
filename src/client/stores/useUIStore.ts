import { create } from 'zustand';

export type SidebarTab = 'case-info' | 'case-materials' | 'analysis';
export type AnalysisSubTab = 'disputes' | 'damages' | 'timeline';

interface UIState {
  // 左側 Chat（保留現有）
  leftSidebarOpen: boolean;

  // 右側 Sidebar
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  analysisSubTab: AnalysisSubTab;

  // 案件資料 Tab 內的收合狀態
  caseMaterialSections: {
    briefs: boolean;
    files: boolean;
    lawRefs: boolean;
  };

  // FileGroup 二級展開狀態（保留）
  rightFilesOpen: boolean;
  rightLawRefsOpen: boolean;

  // Actions
  toggleLeftSidebar: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebarTab: (tab: SidebarTab) => void;
  setAnalysisSubTab: (tab: AnalysisSubTab) => void;
  setCaseMaterialSection: (section: keyof UIState['caseMaterialSections'], open: boolean) => void;
  toggleRightFiles: () => void;
  toggleRightLawRefs: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  leftSidebarOpen: true,

  sidebarOpen: true,
  sidebarTab: 'case-materials',
  analysisSubTab: 'disputes',

  caseMaterialSections: {
    briefs: true,
    files: true,
    lawRefs: true,
  },

  rightFilesOpen: true,
  rightLawRefsOpen: true,

  toggleLeftSidebar: () => set((s) => ({ leftSidebarOpen: !s.leftSidebarOpen })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab, sidebarOpen: true }),
  toggleSidebarTab: (tab) =>
    set((s) => {
      if (s.sidebarOpen && s.sidebarTab === tab) {
        return { sidebarOpen: false };
      }
      return { sidebarTab: tab, sidebarOpen: true };
    }),
  setAnalysisSubTab: (tab) => set({ analysisSubTab: tab }),
  setCaseMaterialSection: (section, open) =>
    set((s) => ({
      caseMaterialSections: { ...s.caseMaterialSections, [section]: open },
    })),
  toggleRightFiles: () => set((s) => ({ rightFilesOpen: !s.rightFilesOpen })),
  toggleRightLawRefs: () => set((s) => ({ rightLawRefsOpen: !s.rightLawRefsOpen })),
}));
