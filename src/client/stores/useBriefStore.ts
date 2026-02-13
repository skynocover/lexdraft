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

type ContentSnapshot = { paragraphs: Paragraph[] }

const MAX_HISTORY = 50

interface BriefState {
  currentBrief: Brief | null
  briefs: Brief[]
  disputes: Dispute[]
  rebuttalTargetFileIds: string[]
  editorMode: 'preview' | 'edit'
  dirty: boolean
  saving: boolean
  highlightCitationId: string | null
  _history: ContentSnapshot[]
  _future: ContentSnapshot[]

  setCurrentBrief: (brief: Brief | null) => void
  setBriefs: (briefs: Brief[]) => void
  setDisputes: (disputes: Dispute[]) => void
  setRebuttalTargetFileIds: (ids: string[]) => void
  setEditorMode: (mode: 'preview' | 'edit') => void
  setDirty: (dirty: boolean) => void
  setHighlightCitationId: (id: string | null) => void

  loadBriefs: (caseId: string) => Promise<void>
  loadBrief: (briefId: string) => Promise<void>
  loadDisputes: (caseId: string) => Promise<void>
  addParagraph: (paragraph: Paragraph) => void
  updateParagraph: (paragraphId: string, paragraph: Paragraph) => void
  removeParagraph: (paragraphId: string) => void
  updateParagraphText: (paragraphId: string, newContentMd: string) => void
  updateParagraphFromEdit: (paragraphId: string, newSegments: TextSegment[]) => void
  updateCitationStatus: (paragraphId: string, citationId: string, status: 'confirmed' | 'rejected') => void
  removeCitation: (paragraphId: string, citationId: string) => void
  deleteBrief: (briefId: string) => Promise<void>
  saveBrief: () => Promise<void>

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  citationStats: () => { confirmed: number; pending: number }
}

function cloneSnapshot(s: ContentSnapshot): ContentSnapshot {
  return JSON.parse(JSON.stringify(s))
}

export const useBriefStore = create<BriefState>((set, get) => ({
  currentBrief: null,
  briefs: [],
  disputes: [],
  rebuttalTargetFileIds: [],
  editorMode: 'preview',
  dirty: false,
  saving: false,
  highlightCitationId: null,
  _history: [],
  _future: [],

  setCurrentBrief: (currentBrief) => set({ currentBrief, _history: [], _future: [] }),
  setBriefs: (briefs) => set({ briefs }),
  setDisputes: (disputes) => set({ disputes }),
  setRebuttalTargetFileIds: (rebuttalTargetFileIds) => set({ rebuttalTargetFileIds }),
  setEditorMode: (editorMode) => set({ editorMode }),
  setDirty: (dirty) => set({ dirty }),
  setHighlightCitationId: (highlightCitationId) => set({ highlightCitationId }),

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
      set({ currentBrief: brief, _history: [], _future: [] })
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

  removeParagraph: (paragraphId: string) => {
    const { currentBrief, _history } = get()
    if (!currentBrief?.content_structured) return

    const snapshot = cloneSnapshot(currentBrief.content_structured)
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: currentBrief.content_structured.paragraphs.filter(
            (p) => p.id !== paragraphId,
          ),
        },
      },
      dirty: true,
      _history: [..._history.slice(-(MAX_HISTORY - 1)), snapshot],
      _future: [],
    })
  },

  updateParagraphText: (paragraphId: string, newContentMd: string) => {
    const { currentBrief, _history } = get()
    if (!currentBrief?.content_structured) return

    const snapshot = cloneSnapshot(currentBrief.content_structured)
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: currentBrief.content_structured.paragraphs.map((p) => {
            if (p.id !== paragraphId) return p
            // Collect all citations from segments (if any) and merge with paragraph-level citations
            const segmentCitations: Citation[] = []
            if (p.segments) {
              for (const seg of p.segments) {
                segmentCitations.push(...seg.citations)
              }
            }
            const allCitations = [...p.citations]
            for (const sc of segmentCitations) {
              if (!allCitations.some((c) => c.id === sc.id)) {
                allCitations.push(sc)
              }
            }
            return {
              ...p,
              content_md: newContentMd,
              segments: undefined,
              citations: allCitations,
            }
          }),
        },
      },
      dirty: true,
      _history: [..._history.slice(-(MAX_HISTORY - 1)), snapshot],
      _future: [],
    })
  },

  updateParagraphFromEdit: (paragraphId: string, newSegments: TextSegment[]) => {
    const { currentBrief, _history } = get()
    if (!currentBrief?.content_structured) return

    const snapshot = cloneSnapshot(currentBrief.content_structured)
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: currentBrief.content_structured.paragraphs.map((p) => {
            if (p.id !== paragraphId) return p
            const newContentMd = newSegments.map((s) => s.text).join('')
            return {
              ...p,
              content_md: newContentMd,
              segments: newSegments,
              citations: p.citations,
            }
          }),
        },
      },
      dirty: true,
      _history: [..._history.slice(-(MAX_HISTORY - 1)), snapshot],
      _future: [],
    })
  },

  updateCitationStatus: (paragraphId: string, citationId: string, status: 'confirmed' | 'rejected') => {
    const { currentBrief, _history } = get()
    if (!currentBrief?.content_structured) return

    const snapshot = cloneSnapshot(currentBrief.content_structured)
    const updateCitation = (c: Citation): Citation =>
      c.id === citationId ? { ...c, status } : c

    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: currentBrief.content_structured.paragraphs.map((p) => {
            if (p.id !== paragraphId) return p
            return {
              ...p,
              citations: p.citations.map(updateCitation),
              segments: p.segments?.map((seg) => ({
                ...seg,
                citations: seg.citations.map(updateCitation),
              })),
            }
          }),
        },
      },
      dirty: true,
      _history: [..._history.slice(-(MAX_HISTORY - 1)), snapshot],
      _future: [],
    })
  },

  removeCitation: (paragraphId: string, citationId: string) => {
    const { currentBrief, _history } = get()
    if (!currentBrief?.content_structured) return

    const snapshot = cloneSnapshot(currentBrief.content_structured)
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: currentBrief.content_structured.paragraphs.map((p) => {
            if (p.id !== paragraphId) return p
            return {
              ...p,
              citations: p.citations.filter((c) => c.id !== citationId),
              segments: p.segments?.map((seg) => ({
                ...seg,
                citations: seg.citations.filter((c) => c.id !== citationId),
              })),
            }
          }),
        },
      },
      dirty: true,
      _history: [..._history.slice(-(MAX_HISTORY - 1)), snapshot],
      _future: [],
    })
  },

  undo: () => {
    const { currentBrief, _history, _future } = get()
    if (_history.length === 0 || !currentBrief?.content_structured) return

    const prev = _history[_history.length - 1]
    const currentSnapshot = cloneSnapshot(currentBrief.content_structured)
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: prev,
      },
      dirty: true,
      _history: _history.slice(0, -1),
      _future: [..._future, currentSnapshot],
    })
  },

  redo: () => {
    const { currentBrief, _history, _future } = get()
    if (_future.length === 0 || !currentBrief?.content_structured) return

    const next = _future[_future.length - 1]
    const currentSnapshot = cloneSnapshot(currentBrief.content_structured)
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: next,
      },
      dirty: true,
      _history: [..._history, currentSnapshot],
      _future: _future.slice(0, -1),
    })
  },

  canUndo: () => get()._history.length > 0,
  canRedo: () => get()._future.length > 0,

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

  saveBrief: async () => {
    const { currentBrief } = get()
    if (!currentBrief?.content_structured) return

    set({ saving: true })
    try {
      await api.put(`/briefs/${currentBrief.id}`, {
        content_structured: currentBrief.content_structured,
      })
      set({ dirty: false })
    } catch (err) {
      console.error('saveBrief error:', err)
    } finally {
      set({ saving: false })
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
      if (p.segments) {
        for (const seg of p.segments) {
          for (const c of seg.citations) {
            if (c.status === 'confirmed') confirmed++
            else if (c.status === 'pending') pending++
          }
        }
      }
    }
    return { confirmed, pending }
  },
}))
