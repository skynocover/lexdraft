import { create } from 'zustand';

export const SIDEBAR_TAB_KEYS = ['case-info', 'disputes', 'case-materials', 'timeline'] as const;
export type SidebarTab = (typeof SIDEBAR_TAB_KEYS)[number];

interface UIState {
  // 左側 Chat（保留現有）
  leftSidebarOpen: boolean;

  // 右側 Sidebar
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;

  // 案件資料 Tab 內的收合狀態
  caseMaterialSections: {
    briefs: boolean;
    files: boolean;
    lawRefs: boolean;
  };

  // Actions
  toggleLeftSidebar: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  toggleSidebarTab: (tab: SidebarTab) => void;
  setCaseMaterialSection: (section: keyof UIState['caseMaterialSections'], open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  leftSidebarOpen: true,

  sidebarOpen: true,
  sidebarTab: 'case-materials',

  caseMaterialSections: {
    briefs: true,
    files: true,
    lawRefs: true,
  },

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
  setCaseMaterialSection: (section, open) =>
    set((s) => ({
      caseMaterialSections: { ...s.caseMaterialSections, [section]: open },
    })),
}));
