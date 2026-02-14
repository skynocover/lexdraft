import { create } from 'zustand';
import { useBriefStore } from './useBriefStore';
import type { Paragraph } from './useBriefStore';
import { useAuthStore } from './useAuthStore';
import { api } from '../lib/api';

interface BriefTab {
  type: 'brief';
  briefId: string;
  title: string;
}

interface FileTab {
  type: 'file';
  fileId: string;
  filename: string;
  pdfUrl: string | null;
  loading: boolean;
  highlightText: string | null;
}

interface VersionPreviewTab {
  type: 'version-preview';
  versionId: string;
  briefId: string;
  briefTitle: string;
  label: string;
  content: { paragraphs: Paragraph[] } | null;
  loading: boolean;
}

export type TabData = BriefTab | FileTab | VersionPreviewTab;

export interface Panel {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

interface TabState {
  tabRegistry: Record<string, TabData>;
  panels: Panel[];
  focusedPanelId: string;

  openBriefTab: (briefId: string, title: string) => void;
  openFileTab: (fileId: string, filename: string) => void;
  openFileTabWithHighlight: (fileId: string, filename: string, highlightText: string) => void;
  openFileTabInOtherPanel: (
    fileId: string,
    filename: string,
    highlightText?: string | null,
  ) => void;
  setFileHighlight: (fileId: string, highlightText: string | null) => void;
  closeTab: (tabId: string, panelId: string) => void;
  setActiveTab: (tabId: string, panelId: string) => void;
  focusPanel: (panelId: string) => void;
  splitPanel: (tabId: string, panelId: string) => void;
  closePanel: (panelId: string) => void;
  moveTab: (tabId: string, fromPanelId: string, toPanelId: string, index?: number) => void;
  reorderTab: (panelId: string, fromIndex: number, toIndex: number) => void;
  openVersionPreviewTab: (
    versionId: string,
    briefId: string,
    label: string,
    briefTitle: string,
  ) => void;
  updateBriefTabTitle: (briefId: string, title: string) => void;
  clearTabs: () => void;
}

const MAIN_PANEL_ID = 'main';

const createMainPanel = (): Panel => ({
  id: MAIN_PANEL_ID,
  tabIds: [],
  activeTabId: null,
});

// Find which panel contains a tab
const findPanelWithTab = (panels: Panel[], tabId: string): Panel | undefined =>
  panels.find((p) => p.tabIds.includes(tabId));

export const useTabStore = create<TabState>((set, get) => ({
  tabRegistry: {},
  panels: [createMainPanel()],
  focusedPanelId: MAIN_PANEL_ID,

  openBriefTab: (briefId, title) => {
    const { tabRegistry, panels, focusedPanelId } = get();
    const tabId = `brief:${briefId}`;

    // If tab already exists in any panel, focus that panel and activate
    const existingPanel = findPanelWithTab(panels, tabId);
    if (existingPanel) {
      set({
        panels: panels.map((p) => (p.id === existingPanel.id ? { ...p, activeTabId: tabId } : p)),
        focusedPanelId: existingPanel.id,
      });
      useBriefStore.getState().loadBrief(briefId);
      return;
    }

    // Add to focused panel
    const newRegistry = {
      ...tabRegistry,
      [tabId]: { type: 'brief' as const, briefId, title },
    };
    set({
      tabRegistry: newRegistry,
      panels: panels.map((p) =>
        p.id === focusedPanelId ? { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId } : p,
      ),
    });
    useBriefStore.getState().loadBrief(briefId);
  },

  openFileTab: (fileId, filename) => {
    const { tabRegistry, panels, focusedPanelId } = get();
    const tabId = `file:${fileId}`;

    // If tab already exists in any panel, focus that panel and activate
    const existingPanel = findPanelWithTab(panels, tabId);
    if (existingPanel) {
      set({
        panels: panels.map((p) => (p.id === existingPanel.id ? { ...p, activeTabId: tabId } : p)),
        focusedPanelId: existingPanel.id,
      });
      return;
    }

    // Add to focused panel
    const newRegistry = {
      ...tabRegistry,
      [tabId]: {
        type: 'file' as const,
        fileId,
        filename,
        pdfUrl: null,
        loading: true,
        highlightText: null,
      },
    };
    set({
      tabRegistry: newRegistry,
      panels: panels.map((p) =>
        p.id === focusedPanelId ? { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId } : p,
      ),
    });

    // Fetch PDF binary → blob URL
    const token = useAuthStore.getState().token;
    fetch(`/api/files/${fileId}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch PDF');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const reg = get().tabRegistry;
        if (reg[tabId]) {
          set({
            tabRegistry: {
              ...reg,
              [tabId]: {
                ...reg[tabId],
                pdfUrl: url,
                loading: false,
              } as FileTab,
            },
          });
        }
      })
      .catch((err) => {
        console.error('Failed to load PDF:', err);
        const reg = get().tabRegistry;
        if (reg[tabId]) {
          set({
            tabRegistry: {
              ...reg,
              [tabId]: {
                ...reg[tabId],
                pdfUrl: null,
                loading: false,
              } as FileTab,
            },
          });
        }
      });
  },

  openFileTabWithHighlight: (fileId, filename, highlightText) => {
    const { openFileTab, setFileHighlight } = get();
    openFileTab(fileId, filename);
    // Set highlight after tab is opened (may be existing or new)
    setFileHighlight(fileId, highlightText);
  },

  openFileTabInOtherPanel: (fileId, filename, highlightText) => {
    const { panels, focusedPanelId, tabRegistry, setFileHighlight } = get();
    const tabId = `file:${fileId}`;

    // If tab already exists in a non-focused panel, just activate it there
    const existingPanel = findPanelWithTab(panels, tabId);
    if (existingPanel && existingPanel.id !== focusedPanelId) {
      set({
        panels: panels.map((p) => (p.id === existingPanel.id ? { ...p, activeTabId: tabId } : p)),
      });
      if (highlightText) setFileHighlight(fileId, highlightText);
      return;
    }

    // If tab exists in the focused panel, split it out to a new panel
    if (existingPanel && existingPanel.id === focusedPanelId) {
      get().splitPanel(tabId, focusedPanelId);
      if (highlightText) setFileHighlight(fileId, highlightText);
      return;
    }

    // Tab doesn't exist yet — find a non-focused panel or create one
    const otherPanel = panels.find((p) => p.id !== focusedPanelId);
    if (otherPanel) {
      // Temporarily switch focus to the other panel, open file, then restore focus
      const prevFocused = focusedPanelId;
      set({ focusedPanelId: otherPanel.id });
      get().openFileTab(fileId, filename);
      if (highlightText) get().setFileHighlight(fileId, highlightText);
      // Restore focus back to the original panel (where the brief is)
      set({ focusedPanelId: prevFocused });
    } else {
      // Only one panel — open the file in it, then split it out
      get().openFileTab(fileId, filename);
      if (highlightText) get().setFileHighlight(fileId, highlightText);
      get().splitPanel(tabId, focusedPanelId);
      // After split, the new panel has focus — restore focus to the original
      set({ focusedPanelId: focusedPanelId });
    }
  },

  setFileHighlight: (fileId, highlightText) => {
    const tabId = `file:${fileId}`;
    const { tabRegistry } = get();
    const tabData = tabRegistry[tabId];
    if (tabData?.type === 'file') {
      set({
        tabRegistry: {
          ...tabRegistry,
          [tabId]: { ...tabData, highlightText },
        },
      });
    }
  },

  closeTab: (tabId, panelId) => {
    const { tabRegistry, panels } = get();
    const panel = panels.find((p) => p.id === panelId);
    if (!panel) return;

    const idx = panel.tabIds.indexOf(tabId);
    if (idx === -1) return;

    // Revoke blob URL if file tab
    const tabData = tabRegistry[tabId];
    if (tabData?.type === 'file' && tabData.pdfUrl) {
      URL.revokeObjectURL(tabData.pdfUrl);
    }

    const newTabIds = panel.tabIds.filter((id) => id !== tabId);

    // Determine new active tab for this panel
    let newActiveTabId = panel.activeTabId;
    if (panel.activeTabId === tabId) {
      if (newTabIds.length === 0) {
        newActiveTabId = null;
      } else if (idx < newTabIds.length) {
        newActiveTabId = newTabIds[idx];
      } else {
        newActiveTabId = newTabIds[newTabIds.length - 1];
      }
    }

    // Check if tab is still used in another panel
    const usedElsewhere = panels.some((p) => p.id !== panelId && p.tabIds.includes(tabId));
    const newRegistry = { ...tabRegistry };
    if (!usedElsewhere) {
      delete newRegistry[tabId];
    }

    // If panel is now empty and it's not the last panel, remove it
    if (newTabIds.length === 0 && panels.length > 1) {
      const newPanels = panels.filter((p) => p.id !== panelId);
      const newFocused = get().focusedPanelId === panelId ? newPanels[0].id : get().focusedPanelId;
      set({
        tabRegistry: newRegistry,
        panels: newPanels,
        focusedPanelId: newFocused,
      });
      // If focus switched, sync brief
      if (newFocused !== get().focusedPanelId) {
        const focusedPanel = newPanels.find((p) => p.id === newFocused);
        const activeData = focusedPanel?.activeTabId ? newRegistry[focusedPanel.activeTabId] : null;
        if (activeData?.type === 'brief') {
          useBriefStore.getState().loadBrief(activeData.briefId);
        }
      }
      return;
    }

    set({
      tabRegistry: newRegistry,
      panels: panels.map((p) =>
        p.id === panelId ? { ...p, tabIds: newTabIds, activeTabId: newActiveTabId } : p,
      ),
    });

    // If the closed tab was active and new active is a brief, sync
    if (panel.activeTabId === tabId && newActiveTabId && panelId === get().focusedPanelId) {
      const newActiveData = newRegistry[newActiveTabId];
      if (newActiveData?.type === 'brief') {
        useBriefStore.getState().loadBrief(newActiveData.briefId);
      }
    }
  },

  setActiveTab: (tabId, panelId) => {
    const { tabRegistry, panels } = get();
    const panel = panels.find((p) => p.id === panelId);
    if (!panel || !panel.tabIds.includes(tabId)) return;

    set({
      panels: panels.map((p) => (p.id === panelId ? { ...p, activeTabId: tabId } : p)),
      focusedPanelId: panelId,
    });

    const tabData = tabRegistry[tabId];
    if (tabData?.type === 'brief') {
      useBriefStore.getState().loadBrief(tabData.briefId);
    }
  },

  focusPanel: (panelId) => {
    const { panels, focusedPanelId, tabRegistry } = get();
    if (panelId === focusedPanelId) return;

    const panel = panels.find((p) => p.id === panelId);
    if (!panel) return;

    set({ focusedPanelId: panelId });

    // Sync brief for newly focused panel
    if (panel.activeTabId) {
      const tabData = tabRegistry[panel.activeTabId];
      if (tabData?.type === 'brief') {
        useBriefStore.getState().loadBrief(tabData.briefId);
      }
    }
  },

  splitPanel: (tabId, panelId) => {
    const { tabRegistry, panels } = get();
    const panel = panels.find((p) => p.id === panelId);
    if (!panel || !panel.tabIds.includes(tabId)) return;
    if (!tabRegistry[tabId]) return;

    const newPanelId = `panel-${Date.now()}`;
    const panelIndex = panels.indexOf(panel);

    // Remove tab from source panel
    const newSourceTabIds = panel.tabIds.filter((id) => id !== tabId);
    let newSourceActive = panel.activeTabId;
    if (panel.activeTabId === tabId) {
      newSourceActive = newSourceTabIds.length > 0 ? newSourceTabIds[0] : null;
    }

    // If source panel would be empty, just move it to a new panel and remove old
    let newPanels: Panel[];
    if (newSourceTabIds.length === 0) {
      // Replace the panel in-place
      newPanels = [...panels];
      newPanels[panelIndex] = {
        id: newPanelId,
        tabIds: [tabId],
        activeTabId: tabId,
      };
    } else {
      // Insert new panel after the source panel
      const updatedSource: Panel = {
        ...panel,
        tabIds: newSourceTabIds,
        activeTabId: newSourceActive,
      };
      newPanels = [...panels];
      newPanels[panelIndex] = updatedSource;
      newPanels.splice(panelIndex + 1, 0, {
        id: newPanelId,
        tabIds: [tabId],
        activeTabId: tabId,
      });
    }

    set({
      panels: newPanels,
      focusedPanelId: newPanelId,
    });

    // Sync brief if the split tab is a brief
    const tabData = tabRegistry[tabId];
    if (tabData?.type === 'brief') {
      useBriefStore.getState().loadBrief(tabData.briefId);
    }
  },

  closePanel: (panelId) => {
    const { tabRegistry, panels } = get();
    if (panels.length <= 1) return;

    const panel = panels.find((p) => p.id === panelId);
    if (!panel) return;

    // Revoke blob URLs for file tabs in this panel
    for (const tabId of panel.tabIds) {
      const tabData = tabRegistry[tabId];
      if (tabData?.type === 'file' && tabData.pdfUrl) {
        URL.revokeObjectURL(tabData.pdfUrl);
      }
    }

    // Remove tabs that are only in this panel
    const newRegistry = { ...tabRegistry };
    for (const tabId of panel.tabIds) {
      const usedElsewhere = panels.some((p) => p.id !== panelId && p.tabIds.includes(tabId));
      if (!usedElsewhere) {
        delete newRegistry[tabId];
      }
    }

    const newPanels = panels.filter((p) => p.id !== panelId);
    const newFocused = get().focusedPanelId === panelId ? newPanels[0].id : get().focusedPanelId;

    set({
      tabRegistry: newRegistry,
      panels: newPanels,
      focusedPanelId: newFocused,
    });
  },

  moveTab: (tabId, fromPanelId, toPanelId, index) => {
    const { panels } = get();
    if (fromPanelId === toPanelId) return;

    const fromPanel = panels.find((p) => p.id === fromPanelId);
    const toPanel = panels.find((p) => p.id === toPanelId);
    if (!fromPanel || !toPanel || !fromPanel.tabIds.includes(tabId)) return;

    // Remove from source
    const newFromTabIds = fromPanel.tabIds.filter((id) => id !== tabId);
    let newFromActive = fromPanel.activeTabId;
    if (fromPanel.activeTabId === tabId) {
      newFromActive = newFromTabIds.length > 0 ? newFromTabIds[0] : null;
    }

    // Add to destination
    const newToTabIds = [...toPanel.tabIds];
    if (index !== undefined && index >= 0 && index <= newToTabIds.length) {
      newToTabIds.splice(index, 0, tabId);
    } else {
      newToTabIds.push(tabId);
    }

    // If source panel is now empty and not the only panel, remove it
    let newPanels: Panel[];
    if (newFromTabIds.length === 0 && panels.length > 1) {
      newPanels = panels
        .filter((p) => p.id !== fromPanelId)
        .map((p) => (p.id === toPanelId ? { ...p, tabIds: newToTabIds, activeTabId: tabId } : p));
    } else {
      newPanels = panels.map((p) => {
        if (p.id === fromPanelId) {
          return { ...p, tabIds: newFromTabIds, activeTabId: newFromActive };
        }
        if (p.id === toPanelId) {
          return { ...p, tabIds: newToTabIds, activeTabId: tabId };
        }
        return p;
      });
    }

    set({
      panels: newPanels,
      focusedPanelId: toPanelId,
    });

    // Sync brief if moved tab is a brief
    const tabData = get().tabRegistry[tabId];
    if (tabData?.type === 'brief') {
      useBriefStore.getState().loadBrief(tabData.briefId);
    }
  },

  reorderTab: (panelId, fromIndex, toIndex) => {
    const { panels } = get();
    const panel = panels.find((p) => p.id === panelId);
    if (!panel) return;

    const newTabIds = [...panel.tabIds];
    const [moved] = newTabIds.splice(fromIndex, 1);
    newTabIds.splice(toIndex, 0, moved);

    set({
      panels: panels.map((p) => (p.id === panelId ? { ...p, tabIds: newTabIds } : p)),
    });
  },

  openVersionPreviewTab: (versionId, briefId, label, briefTitle) => {
    const { tabRegistry, panels, focusedPanelId } = get();
    const tabId = `version:${versionId}`;

    // If tab already exists in any panel, focus it
    const existingPanel = findPanelWithTab(panels, tabId);
    if (existingPanel) {
      set({
        panels: panels.map((p) => (p.id === existingPanel.id ? { ...p, activeTabId: tabId } : p)),
        focusedPanelId: existingPanel.id,
      });
      return;
    }

    // Create tab data (loading state)
    const newRegistry = {
      ...tabRegistry,
      [tabId]: {
        type: 'version-preview' as const,
        versionId,
        briefId,
        briefTitle,
        label,
        content: null,
        loading: true,
      },
    };

    // Open in another panel (like file preview)
    const otherPanel = panels.find((p) => p.id !== focusedPanelId);
    if (otherPanel) {
      set({
        tabRegistry: newRegistry,
        panels: panels.map((p) =>
          p.id === otherPanel.id ? { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId } : p,
        ),
      });
    } else {
      // Only one panel — add tab then split
      set({
        tabRegistry: newRegistry,
        panels: panels.map((p) =>
          p.id === focusedPanelId ? { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId } : p,
        ),
      });
      get().splitPanel(tabId, focusedPanelId);
      // Restore focus to original panel (where the brief is)
      set({ focusedPanelId });
    }

    // Fetch version content
    api
      .get<{ content_structured: { paragraphs: Paragraph[] } | null }>(
        `/brief-versions/${versionId}`,
      )
      .then((data) => {
        const reg = get().tabRegistry;
        if (reg[tabId]) {
          set({
            tabRegistry: {
              ...reg,
              [tabId]: {
                ...reg[tabId],
                content: data.content_structured || { paragraphs: [] },
                loading: false,
              } as VersionPreviewTab,
            },
          });
        }
      })
      .catch((err) => {
        console.error('Failed to load version:', err);
        const reg = get().tabRegistry;
        if (reg[tabId]) {
          set({
            tabRegistry: {
              ...reg,
              [tabId]: {
                ...reg[tabId],
                content: null,
                loading: false,
              } as VersionPreviewTab,
            },
          });
        }
      });
  },

  updateBriefTabTitle: (briefId, title) => {
    const tabId = `brief:${briefId}`;
    const { tabRegistry } = get();
    const tabData = tabRegistry[tabId];
    if (tabData?.type === 'brief') {
      set({
        tabRegistry: { ...tabRegistry, [tabId]: { ...tabData, title } },
      });
    }
  },

  clearTabs: () => {
    // Revoke all blob URLs
    const { tabRegistry } = get();
    for (const tabData of Object.values(tabRegistry)) {
      if (tabData.type === 'file' && tabData.pdfUrl) {
        URL.revokeObjectURL(tabData.pdfUrl);
      }
    }
    set({
      tabRegistry: {},
      panels: [createMainPanel()],
      focusedPanelId: MAIN_PANEL_ID,
    });
  },
}));
