import { create } from 'zustand'

export interface Citation {
  id: string
  label: string
  type: 'file' | 'law'
  file_id?: string
  location?: { page: number; char_start: number; char_end: number }
  quoted_text: string
  status: 'confirmed' | 'pending' | 'rejected'
}

export interface Paragraph {
  id: string
  section: string
  subsection: string
  content_md: string
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
  evidence: string | null
  law_refs: string | null
  priority: number
}

interface BriefState {
  currentBrief: Brief | null
  briefs: Brief[]
  disputes: Dispute[]
  setCurrentBrief: (brief: Brief | null) => void
  setBriefs: (briefs: Brief[]) => void
  setDisputes: (disputes: Dispute[]) => void
}

export const useBriefStore = create<BriefState>((set) => ({
  currentBrief: null,
  briefs: [],
  disputes: [],
  setCurrentBrief: (currentBrief) => set({ currentBrief }),
  setBriefs: (briefs) => set({ briefs }),
  setDisputes: (disputes) => set({ disputes }),
}))
