import { create } from 'zustand'

export interface Case {
  id: string
  title: string
  case_number: string | null
  court: string | null
  case_type: string | null
  plaintiff: string | null
  defendant: string | null
  created_at: string
  updated_at: string
}

export interface CaseFile {
  id: string
  case_id: string
  filename: string
  file_size: number | null
  mime_type: string | null
  status: 'pending' | 'processing' | 'ready' | 'error'
  category: 'ours' | 'theirs' | 'court' | 'evidence' | 'other' | null
  doc_type: string | null
  doc_date: string | null
  summary: string | null
  created_at: string
}

interface CaseState {
  cases: Case[]
  currentCase: Case | null
  files: CaseFile[]
  setCases: (cases: Case[]) => void
  setCurrentCase: (c: Case | null) => void
  setFiles: (files: CaseFile[]) => void
}

export const useCaseStore = create<CaseState>((set) => ({
  cases: [],
  currentCase: null,
  files: [],
  setCases: (cases) => set({ cases }),
  setCurrentCase: (currentCase) => set({ currentCase }),
  setFiles: (files) => set({ files }),
}))
