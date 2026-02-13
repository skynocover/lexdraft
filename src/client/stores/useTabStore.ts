import { create } from 'zustand'
import { useBriefStore } from './useBriefStore'
import { useAuthStore } from './useAuthStore'

interface BriefTab {
  type: 'brief'
  briefId: string
  title: string
}

interface FileTab {
  type: 'file'
  fileId: string
  filename: string
  pdfUrl: string | null
  loading: boolean
}

type TabData = BriefTab | FileTab

interface Tab {
  id: string
  data: TabData
}

interface TabState {
  tabs: Tab[]
  activeTabId: string | null

  openBriefTab: (briefId: string, title: string) => void
  openFileTab: (fileId: string, filename: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateBriefTabTitle: (briefId: string, title: string) => void
  clearTabs: () => void
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openBriefTab: (briefId, title) => {
    const { tabs } = get()
    const tabId = `brief:${briefId}`
    const existing = tabs.find((t) => t.id === tabId)

    if (existing) {
      set({ activeTabId: tabId })
    } else {
      set({
        tabs: [...tabs, { id: tabId, data: { type: 'brief', briefId, title } }],
        activeTabId: tabId,
      })
    }

    // Sync currentBrief
    useBriefStore.getState().loadBrief(briefId)
  },

  openFileTab: (fileId, filename) => {
    const { tabs } = get()
    const tabId = `file:${fileId}`
    const existing = tabs.find((t) => t.id === tabId)

    if (existing) {
      set({ activeTabId: tabId })
      return
    }

    set({
      tabs: [...tabs, { id: tabId, data: { type: 'file', fileId, filename, pdfUrl: null, loading: true } }],
      activeTabId: tabId,
    })

    // Fetch PDF binary → blob URL
    const token = useAuthStore.getState().token
    fetch(`/api/files/${fileId}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch PDF')
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId
              ? { ...t, data: { ...t.data, pdfUrl: url, loading: false } as FileTab }
              : t,
          ),
        })
      })
      .catch((err) => {
        console.error('Failed to load PDF:', err)
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId
              ? { ...t, data: { ...t.data, pdfUrl: null, loading: false } as FileTab }
              : t,
          ),
        })
      })
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

    // Revoke blob URL if file tab
    const closing = tabs[idx]
    if (closing.data.type === 'file' && closing.data.pdfUrl) {
      URL.revokeObjectURL(closing.data.pdfUrl)
    }

    const newTabs = tabs.filter((t) => t.id !== tabId)

    let newActiveId = activeTabId
    if (activeTabId === tabId) {
      if (newTabs.length === 0) {
        newActiveId = null
      } else if (idx < newTabs.length) {
        newActiveId = newTabs[idx].id
      } else {
        newActiveId = newTabs[newTabs.length - 1].id
      }
    }

    set({ tabs: newTabs, activeTabId: newActiveId })

    // If new active is a brief tab, sync currentBrief
    if (newActiveId) {
      const newActive = newTabs.find((t) => t.id === newActiveId)
      if (newActive?.data.type === 'brief') {
        useBriefStore.getState().loadBrief(newActive.data.briefId)
      }
    }
  },

  setActiveTab: (tabId) => {
    const { tabs } = get()
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return

    set({ activeTabId: tabId })

    if (tab.data.type === 'brief') {
      useBriefStore.getState().loadBrief(tab.data.briefId)
    }
  },

  updateBriefTabTitle: (briefId, title) => {
    const tabId = `brief:${briefId}`
    set({
      tabs: get().tabs.map((t) =>
        t.id === tabId && t.data.type === 'brief'
          ? { ...t, data: { ...t.data, title } }
          : t,
      ),
    })
  },

  clearTabs: () => {
    // Revoke all blob URLs
    for (const tab of get().tabs) {
      if (tab.data.type === 'file' && tab.data.pdfUrl) {
        URL.revokeObjectURL(tab.data.pdfUrl)
      }
    }
    set({ tabs: [], activeTabId: null })
  },
}))
