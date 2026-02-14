import { create } from 'zustand'
import { api } from '../lib/api'

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

export interface Damage {
  id: string
  case_id: string
  category: string
  description: string | null
  amount: number
  basis: string | null
  evidence_refs: string[]
  dispute_id: string | null
  created_at: string
}

export interface TimelineEvent {
  date: string
  title: string
  description: string
  source_file: string
  is_critical: boolean
}

export interface Party {
  role: 'plaintiff' | 'defendant'
  name: string
  description?: string
}

interface AnalysisState {
  disputes: Dispute[]
  damages: Damage[]
  timeline: TimelineEvent[]
  parties: Party[]
  highlightDisputeId: string | null

  setDisputes: (disputes: Dispute[]) => void
  setDamages: (damages: Damage[]) => void
  setTimeline: (timeline: TimelineEvent[]) => void
  setParties: (parties: Party[]) => void
  setHighlightDisputeId: (id: string | null) => void

  loadDisputes: (caseId: string) => Promise<void>
  loadDamages: (caseId: string) => Promise<void>
  loadTimeline: (caseId: string) => Promise<void>
  loadParties: (caseId: string) => Promise<void>
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  disputes: [],
  damages: [],
  timeline: [],
  parties: [],
  highlightDisputeId: null,

  setDisputes: (disputes) => set({ disputes }),
  setDamages: (damages) => set({ damages }),
  setTimeline: (timeline) => set({ timeline }),
  setParties: (parties) => set({ parties }),
  setHighlightDisputeId: (highlightDisputeId) => set({ highlightDisputeId }),

  loadDisputes: async (caseId: string) => {
    try {
      const disputes = await api.get<Dispute[]>(`/cases/${caseId}/disputes`)
      set({ disputes })
    } catch (err) {
      console.error('loadDisputes error:', err)
    }
  },

  loadDamages: async (caseId: string) => {
    try {
      const damages = await api.get<Damage[]>(`/cases/${caseId}/damages`)
      set({ damages })
    } catch (err) {
      console.error('loadDamages error:', err)
    }
  },

  loadTimeline: async (caseId: string) => {
    try {
      const timeline = await api.get<TimelineEvent[]>(`/cases/${caseId}/timeline`)
      set({ timeline })
    } catch (err) {
      console.error('loadTimeline error:', err)
    }
  },

  loadParties: async (caseId: string) => {
    try {
      const parties = await api.get<Party[]>(`/cases/${caseId}/parties`)
      set({ parties })
    } catch (err) {
      console.error('loadParties error:', err)
    }
  },
}))
