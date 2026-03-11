import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { ANALYSIS_LABELS, type AnalysisType, type SimpleFact } from '../../shared/types';

export type { SimpleFact };

export interface Dispute {
  id: string;
  case_id: string;
  number: number;
  title: string | null;
  our_position: string | null;
  their_position: string | null;
  evidence: string[] | null;
  law_refs: string[] | null;
}

export interface Damage {
  id: string;
  case_id: string;
  category: string;
  description: string | null;
  amount: number;
  basis: string | null;
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
type DamageInput = Omit<Damage, 'id' | 'case_id' | 'created_at'>;

export type { AnalysisType };

interface AnalysisResponse {
  success: boolean;
  data?: unknown[];
  summary?: string;
  error?: string;
}

interface AnalysisState {
  disputes: Dispute[];
  undisputedFacts: SimpleFact[];
  informationGaps: string[];
  damages: Damage[];
  timeline: TimelineEvent[];
  parties: Party[];
  claims: ClaimGraph[];
  analyzingType: AnalysisType | null;

  setDisputes: (disputes: Dispute[]) => void;
  setUndisputedFacts: (facts: SimpleFact[]) => void;
  setInformationGaps: (gaps: string[]) => void;
  setDamages: (damages: Damage[]) => void;
  setTimeline: (timeline: TimelineEvent[]) => void;
  setParties: (parties: Party[]) => void;
  setClaims: (claims: ClaimGraph[]) => void;

  loadDisputes: (caseId: string) => Promise<void>;
  loadDamages: (caseId: string) => Promise<void>;
  loadTimeline: (caseId: string) => Promise<void>;
  loadParties: (caseId: string) => Promise<void>;
  loadClaims: (caseId: string) => Promise<void>;

  runAnalysis: (caseId: string, type: AnalysisType) => Promise<void>;

  // Timeline CRUD
  addTimelineEvent: (caseId: string, data: TimelineInput) => Promise<void>;
  updateTimelineEvent: (
    caseId: string,
    eventId: string,
    updates: Partial<TimelineInput>,
  ) => Promise<void>;
  removeTimelineEvent: (caseId: string, eventId: string) => Promise<void>;

  // Disputes CRUD
  updateDispute: (caseId: string, disputeId: string, updates: { title: string }) => Promise<void>;
  removeDispute: (caseId: string, disputeId: string) => Promise<void>;

  // Undisputed Facts CRUD
  addFact: (caseId: string, description: string) => Promise<void>;
  updateFact: (caseId: string, factId: string, description: string) => Promise<void>;
  removeFact: (caseId: string, factId: string) => Promise<void>;

  // Damages CRUD
  addDamage: (caseId: string, data: DamageInput) => Promise<void>;
  updateDamage: (damageId: string, updates: Partial<DamageInput>) => Promise<void>;
  removeDamage: (damageId: string) => Promise<void>;
}

const makeLoader =
  <T>(
    key: keyof AnalysisState,
    endpoint: string,
    set: (s: Partial<AnalysisState>) => void,
    get: () => AnalysisState,
  ) =>
  async (caseId: string) => {
    try {
      const data = await api.get<T[]>(`/cases/${caseId}/${endpoint}`);
      const current = get()[key] as unknown[];
      if (Array.isArray(current) && current.length === 0 && data.length === 0) return;
      set({ [key]: data } as Partial<AnalysisState>);
    } catch (err) {
      console.error(`load ${key} error:`, err);
      const extraLabels: Record<string, string> = { parties: '當事人', claims: '主張' };
      const label = ANALYSIS_LABELS[key as AnalysisType] ?? extraLabels[key as string] ?? key;
      toast.error(`載入${label}失敗`, { id: 'case-load' });
    }
  };

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  disputes: [],
  undisputedFacts: [],
  informationGaps: [],
  damages: [],
  timeline: [],
  parties: [],
  claims: [],
  analyzingType: null,

  setDisputes: (disputes) => set({ disputes }),
  setUndisputedFacts: (undisputedFacts) => set({ undisputedFacts }),
  setInformationGaps: (informationGaps) => set({ informationGaps }),
  setDamages: (damages) => set({ damages }),
  setTimeline: (timeline) => set({ timeline }),
  setParties: (parties) => set({ parties }),
  setClaims: (claims) => set({ claims }),

  loadDisputes: makeLoader<Dispute>('disputes', 'disputes', set, get),
  loadDamages: makeLoader<Damage>('damages', 'damages', set, get),
  loadTimeline: makeLoader<TimelineEvent>('timeline', 'timeline', set, get),
  loadParties: makeLoader<Party>('parties', 'parties', set, get),
  loadClaims: makeLoader<ClaimGraph>('claims', 'claims', set, get),

  // Direct analysis API
  runAnalysis: async (caseId, type) => {
    set({ analyzingType: type });
    try {
      const res = await api.post<AnalysisResponse>(`/cases/${caseId}/analyze`, { type });
      if (type === 'disputes') {
        const items = res.data as Dispute[];
        set({ disputes: items });
        toast.success(`爭點分析完成（${items.length} 個爭點）`);
      } else if (type === 'damages') {
        const items = res.data as Damage[];
        const total = items.reduce((s, d) => s + d.amount, 0);
        set({ damages: items });
        toast.success(`金額計算完成，請求總額 NT$ ${total.toLocaleString()}`);
      } else if (type === 'timeline') {
        const items = res.data as TimelineEvent[];
        set({ timeline: items });
        toast.success(`時間軸已產生（${items.length} 個事件）`);
      }
    } catch (err: unknown) {
      console.error(`runAnalysis ${type} error:`, err);
      const msg =
        err instanceof Error ? err.message : `${ANALYSIS_LABELS[type]}分析失敗，請稍後再試`;
      toast.error(msg);
    } finally {
      set({ analyzingType: null });
    }
  },

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

  // Disputes CRUD
  updateDispute: async (caseId, disputeId, updates) => {
    const updated = await api.patch<Dispute>(`/cases/${caseId}/disputes/${disputeId}`, updates);
    set({ disputes: get().disputes.map((d) => (d.id === disputeId ? updated : d)) });
  },

  removeDispute: async (caseId, disputeId) => {
    await api.delete(`/cases/${caseId}/disputes/${disputeId}`);
    set({
      disputes: get().disputes.filter((d) => d.id !== disputeId),
      claims: get().claims.filter((c) => c.dispute_id !== disputeId),
    });
  },

  // Undisputed Facts CRUD
  addFact: async (caseId, description) => {
    const prev = get().undisputedFacts;
    const newFact: SimpleFact = { id: nanoid(), description };
    const updated = [...prev, newFact];
    set({ undisputedFacts: updated });
    try {
      await api.put(`/cases/${caseId}/undisputed-facts`, { facts: updated });
    } catch {
      set({ undisputedFacts: prev });
      toast.error('新增不爭執事項失敗');
    }
  },

  updateFact: async (caseId, factId, description) => {
    const prev = get().undisputedFacts;
    const target = prev.find((f) => f.id === factId);
    if (!target || target.description === description) return;
    const updated = prev.map((f) => (f.id === factId ? { ...f, description } : f));
    set({ undisputedFacts: updated });
    try {
      await api.put(`/cases/${caseId}/undisputed-facts`, { facts: updated });
    } catch {
      set({ undisputedFacts: prev });
      toast.error('更新不爭執事項失敗');
    }
  },

  removeFact: async (caseId, factId) => {
    const prev = get().undisputedFacts;
    const updated = prev.filter((f) => f.id !== factId);
    set({ undisputedFacts: updated });
    try {
      await api.put(`/cases/${caseId}/undisputed-facts`, { facts: updated });
    } catch {
      set({ undisputedFacts: prev });
      toast.error('刪除不爭執事項失敗');
    }
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
