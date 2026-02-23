import { create } from 'zustand';
import { api } from '../lib/api';

export interface Case {
  id: string;
  title: string;
  case_number: string | null;
  court: string | null;
  case_type: string | null;
  plaintiff: string | null;
  defendant: string | null;
  client_role: 'plaintiff' | 'defendant' | null;
  case_instructions: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseFile {
  id: string;
  case_id: string;
  filename: string;
  file_size: number | null;
  mime_type: string | null;
  status: 'pending' | 'processing' | 'ready' | 'error';
  category: 'ours' | 'theirs' | 'court' | 'evidence' | 'other' | null;
  doc_date: string | null;
  summary: string | null;
  created_at: string;
}

interface CaseState {
  cases: Case[];
  currentCase: Case | null;
  files: CaseFile[];
  setCases: (cases: Case[]) => void;
  setCurrentCase: (c: Case | null) => void;
  setFiles: (files: CaseFile[]) => void;
  updateCase: (
    caseId: string,
    data: Partial<Omit<Case, 'id' | 'created_at' | 'updated_at'>>,
  ) => Promise<void>;
  deleteCase: (caseId: string) => Promise<void>;
}

export const useCaseStore = create<CaseState>((set, get) => ({
  cases: [],
  currentCase: null,
  files: [],
  setCases: (cases) => set({ cases }),
  setCurrentCase: (currentCase) => set({ currentCase }),
  setFiles: (files) => set({ files }),
  updateCase: async (caseId, data) => {
    const res = await api.put<Case>(`/cases/${caseId}`, data);
    set((s) => ({
      currentCase: res,
      cases: s.cases.map((c) => (c.id === caseId ? res : c)),
    }));
  },
  deleteCase: async (caseId: string) => {
    await api.delete(`/cases/${caseId}`);
    set({ cases: get().cases.filter((c) => c.id !== caseId) });
  },
}));
