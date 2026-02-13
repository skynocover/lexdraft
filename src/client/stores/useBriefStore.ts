import { create } from 'zustand'
import { api } from '../lib/api'

export interface Citation {
  id: string
  label: string
  type: 'file' | 'law'
  file_id?: string
  location?: { page: number; char_start: number; char_end: number }
  quoted_text: string
  status: 'confirmed' | 'pending' | 'rejected'
}

export interface TextSegment {
  text: string
  citations: Citation[]
}

export interface Paragraph {
  id: string
  section: string
  subsection: string
  content_md: string
  segments?: TextSegment[]
  dispute_id: string | null
  citations: Citation[]
}

export interface Brief {
  id: string
  case_id: string
  brief_type: string
  title: string | null
  content_structured: { paragraphs: Paragraph[] } | null
  version: number
  created_at: string
  updated_at: string
}

export interface Dispute {
  id: string
  case_id: string
  brief_id: string | null
  number: number
  title: string | null
  our_position: string | null
  their_position: string | null
  evidence: string[] | null
  law_refs: string[] | null
  priority: number
}

interface BriefState {
  currentBrief: Brief | null
  briefs: Brief[]
  disputes: Dispute[]
  rebuttalTargetFileIds: string[]

  setCurrentBrief: (brief: Brief | null) => void
  setBriefs: (briefs: Brief[]) => void
  setDisputes: (disputes: Dispute[]) => void
  setRebuttalTargetFileIds: (ids: string[]) => void

  loadBriefs: (caseId: string) => Promise<void>
  loadBrief: (briefId: string) => Promise<void>
  loadDisputes: (caseId: string) => Promise<void>
  addParagraph: (paragraph: Paragraph) => void
  updateParagraph: (paragraphId: string, paragraph: Paragraph) => void
  deleteBrief: (briefId: string) => Promise<void>

  citationStats: () => { confirmed: number; pending: number }
}

export const useBriefStore = create<BriefState>((set, get) => ({
  currentBrief: null,
  briefs: [],
  disputes: [],
  rebuttalTargetFileIds: [],

  setCurrentBrief: (currentBrief) => set({ currentBrief }),
  setBriefs: (briefs) => set({ briefs }),
  setDisputes: (disputes) => set({ disputes }),
  setRebuttalTargetFileIds: (rebuttalTargetFileIds) => set({ rebuttalTargetFileIds }),

  loadBriefs: async (caseId: string) => {
    try {
      const briefs = await api.get<Brief[]>(`/cases/${caseId}/briefs`)
      set({ briefs })
    } catch (err) {
      console.error('loadBriefs error:', err)
    }
  },

  loadBrief: async (briefId: string) => {
    try {
      const brief = await api.get<Brief>(`/briefs/${briefId}`)
      set({ currentBrief: brief })
    } catch (err) {
      console.error('loadBrief error:', err)
    }
  },

  loadDisputes: async (caseId: string) => {
    try {
      const disputes = await api.get<Dispute[]>(`/cases/${caseId}/disputes`)
      set({ disputes })
    } catch (err) {
      console.error('loadDisputes error:', err)
    }
  },

  addParagraph: (paragraph: Paragraph) => {
    const { currentBrief } = get()
    if (!currentBrief) return

    const content = currentBrief.content_structured || { paragraphs: [] }
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: [...content.paragraphs, paragraph],
        },
      },
    })
  },

  updateParagraph: (paragraphId: string, paragraph: Paragraph) => {
    const { currentBrief } = get()
    if (!currentBrief?.content_structured) return

    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: currentBrief.content_structured.paragraphs.map((p) =>
            p.id === paragraphId ? paragraph : p,
          ),
        },
      },
    })
  },

  deleteBrief: async (briefId: string) => {
    try {
      await api.delete(`/briefs/${briefId}`)
      const { briefs, currentBrief } = get()
      set({ briefs: briefs.filter((b) => b.id !== briefId) })
      if (currentBrief?.id === briefId) {
        set({ currentBrief: null })
      }
    } catch (err) {
      console.error('deleteBrief error:', err)
    }
  },

  citationStats: () => {
    const { currentBrief } = get()
    if (!currentBrief?.content_structured) return { confirmed: 0, pending: 0 }

    let confirmed = 0
    let pending = 0
    for (const p of currentBrief.content_structured.paragraphs) {
      for (const c of p.citations) {
        if (c.status === 'confirmed') confirmed++
        else if (c.status === 'pending') pending++
      }
    }
    return { confirmed, pending }
  },
}))
