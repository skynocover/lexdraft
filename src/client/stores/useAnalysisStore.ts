import { create } from 'zustand';
import { api } from '../lib/api';

export interface StructuredFact {
  id: string;
  description: string;
  assertion_type: '主張' | '承認' | '爭執' | '自認' | '推定';
  source_side: '我方' | '對方' | '中立';
  evidence: string[];
  disputed_by: string | null;
}

export interface Dispute {
  id: string;
  case_id: string;
  number: number;
  title: string | null;
  our_position: string | null;
  their_position: string | null;
  evidence: string[] | null;
  law_refs: string[] | null;
  facts?: StructuredFact[];
}

export interface Damage {
  id: string;
  case_id: string;
  category: string;
  description: string | null;
  amount: number;
  basis: string | null;
  dispute_id: string | null;
  created_at: string;
}

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  description: string;
  is_critical: boolean;
}

export interface Party {
  role: 'plaintiff' | 'defendant';
  name: string;
  description?: string;
}

export interface ClaimGraph {
  id: string;
  side: 'ours' | 'theirs';
  claim_type: 'primary' | 'rebuttal' | 'supporting';
  statement: string;
  assigned_section: string | null;
  dispute_id: string | null;
  responds_to: string | null;
}

type TimelineInput = Omit<TimelineEvent, 'id'>;
type DamageInput = Omit<Damage, 'id' | 'case_id' | 'created_at' | 'dispute_id'> & {
  dispute_id?: string | null;
};

interface AnalysisState {
  disputes: Dispute[];
  damages: Damage[];
  timeline: TimelineEvent[];
  parties: Party[];
  claims: ClaimGraph[];
  highlightDisputeId: string | null;

  setDisputes: (disputes: Dispute[]) => void;
  setDamages: (damages: Damage[]) => void;
  setTimeline: (timeline: TimelineEvent[]) => void;
  setParties: (parties: Party[]) => void;
  setClaims: (claims: ClaimGraph[]) => void;
  setHighlightDisputeId: (id: string | null) => void;

  loadDisputes: (caseId: string) => Promise<void>;
  loadDamages: (caseId: string) => Promise<void>;
  loadTimeline: (caseId: string) => Promise<void>;
  loadParties: (caseId: string) => Promise<void>;
  loadClaims: (caseId: string) => Promise<void>;

  // Timeline CRUD
  addTimelineEvent: (caseId: string, data: TimelineInput) => Promise<void>;
  updateTimelineEvent: (
    caseId: string,
    eventId: string,
    updates: Partial<TimelineInput>,
  ) => Promise<void>;
  removeTimelineEvent: (caseId: string, eventId: string) => Promise<void>;

  // Damages CRUD
  addDamage: (caseId: string, data: DamageInput) => Promise<void>;
  updateDamage: (damageId: string, updates: Partial<DamageInput>) => Promise<void>;
  removeDamage: (damageId: string) => Promise<void>;
}

const makeLoader =
  <T>(key: keyof AnalysisState, endpoint: string, set: (s: Partial<AnalysisState>) => void) =>
  async (caseId: string) => {
    try {
      const data = await api.get<T[]>(`/cases/${caseId}/${endpoint}`);
      set({ [key]: data } as Partial<AnalysisState>);
    } catch (err) {
      console.error(`load ${key} error:`, err);
    }
  };

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  disputes: [],
  damages: [],
  timeline: [],
  parties: [],
  claims: [],
  highlightDisputeId: null,

  setDisputes: (disputes) => set({ disputes }),
  setDamages: (damages) => set({ damages }),
  setTimeline: (timeline) => set({ timeline }),
  setParties: (parties) => set({ parties }),
  setClaims: (claims) => set({ claims }),
  setHighlightDisputeId: (highlightDisputeId) => set({ highlightDisputeId }),

  loadDisputes: makeLoader<Dispute>('disputes', 'disputes', set),
  loadDamages: makeLoader<Damage>('damages', 'damages', set),
  loadTimeline: makeLoader<TimelineEvent>('timeline', 'timeline', set),
  loadParties: makeLoader<Party>('parties', 'parties', set),
  loadClaims: makeLoader<ClaimGraph>('claims', 'claims', set),

  // Timeline CRUD
  addTimelineEvent: async (caseId, data) => {
    const created = await api.post<TimelineEvent>(`/cases/${caseId}/timeline`, data);
    const timeline = [...get().timeline, created].sort((a, b) => a.date.localeCompare(b.date));
    set({ timeline });
  },

  updateTimelineEvent: async (caseId, eventId, updates) => {
    const updated = await api.put<TimelineEvent>(`/cases/${caseId}/timeline/${eventId}`, updates);
    const timeline = get()
      .timeline.map((e) => (e.id === eventId ? updated : e))
      .sort((a, b) => a.date.localeCompare(b.date));
    set({ timeline });
  },

  removeTimelineEvent: async (caseId, eventId) => {
    await api.delete(`/cases/${caseId}/timeline/${eventId}`);
    set({ timeline: get().timeline.filter((e) => e.id !== eventId) });
  },

  // Damages CRUD
  addDamage: async (caseId, data) => {
    const created = await api.post<Damage>(`/cases/${caseId}/damages`, data);
    set({ damages: [...get().damages, created] });
  },

  updateDamage: async (damageId, updates) => {
    const updated = await api.put<Damage>(`/damages/${damageId}`, updates);
    set({ damages: get().damages.map((d) => (d.id === damageId ? updated : d)) });
  },

  removeDamage: async (damageId) => {
    await api.delete(`/damages/${damageId}`);
    set({ damages: get().damages.filter((d) => d.id !== damageId) });
  },
}));
