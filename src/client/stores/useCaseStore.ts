import { create } from 'zustand';
import { api } from '../lib/api';
import type { FileCategoryValue } from '../../shared/caseConstants';

export interface Case {
  id: string;
  title: string;
  case_number: string | null;
  court: string | null;
  plaintiff: string | null;
  defendant: string | null;
  client_role: 'plaintiff' | 'defendant' | null;
  case_instructions: string | null;
  division: string | null;
  template_id: string | null;
  undisputed_facts: string | null;
  information_gaps: string | null;
  disputes_analyzed_at: string | null;
  timeline_analyzed_at: string | null;
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
  category: FileCategoryValue | null;
  doc_date: string | null;
  summary: string | null;
  created_at: string;
}

interface CaseState {
  cases: Case[];
  currentCase: Case | null;
  files: CaseFile[];
  isDemo: boolean;
  setCases: (cases: Case[]) => void;
  setCurrentCase: (c: Case | null) => void;
  setFiles: (files: CaseFile[]) => void;
  setIsDemo: (val: boolean) => void;
  updateCase: (
    caseId: string,
    data: Partial<Omit<Case, 'id' | 'created_at' | 'updated_at'>>,
  ) => Promise<void>;
  deleteCase: (caseId: string) => Promise<void>;
  patchCurrentCase: (
    patch: Partial<Pick<Case, 'disputes_analyzed_at' | 'timeline_analyzed_at'>>,
  ) => void;
}

export const useCaseStore = create<CaseState>((set, get) => ({
  cases: [],
  currentCase: null,
  files: [],
  isDemo: false,
  setCases: (cases) => set({ cases }),
  setCurrentCase: (currentCase) => set({ currentCase }),
  setFiles: (files) => set({ files }),
  setIsDemo: (isDemo) => set({ isDemo }),
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
  patchCurrentCase: (patch) =>
    set((s) => ({
      currentCase: s.currentCase ? { ...s.currentCase, ...patch } : null,
    })),
}));
