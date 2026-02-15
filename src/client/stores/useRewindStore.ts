import { create } from 'zustand';
import { useBriefStore, type Paragraph, type LawRef } from './useBriefStore';
import {
  useAnalysisStore,
  type Dispute,
  type Damage,
  type TimelineEvent,
  type Party,
} from './useAnalysisStore';

interface TurnSnapshot {
  brief: { paragraphs: Paragraph[]; lawRefs: LawRef[] };
  analysis: {
    disputes: Dispute[];
    damages: Damage[];
    timeline: TimelineEvent[];
    parties: Party[];
  };
  hadChanges: boolean;
}

const MAX_SNAPSHOTS = 20;

interface RewindState {
  snapshots: Record<string, TurnSnapshot>;
  captureSnapshot: (messageId: string) => void;
  removeSnapshot: (messageId: string) => void;
  transferSnapshot: (fromId: string, toId: string) => void;
  markHasChanges: (messageId: string) => void;
  rewind: (messageId: string) => void;
  clear: () => void;
}

export const useRewindStore = create<RewindState>((set, get) => ({
  snapshots: {},

  captureSnapshot: (messageId: string) => {
    const briefState = useBriefStore.getState();
    const analysisState = useAnalysisStore.getState();

    const paragraphs = briefState.currentBrief?.content_structured?.paragraphs ?? [];
    const lawRefs = briefState.lawRefs;

    const snapshot: TurnSnapshot = {
      brief: {
        paragraphs: structuredClone(paragraphs),
        lawRefs: structuredClone(lawRefs),
      },
      analysis: {
        disputes: structuredClone(analysisState.disputes),
        damages: structuredClone(analysisState.damages),
        timeline: structuredClone(analysisState.timeline),
        parties: structuredClone(analysisState.parties),
      },
      hadChanges: false,
    };

    const current = get().snapshots;
    const keys = Object.keys(current);

    // Evict oldest if over limit
    const updated = { ...current };
    if (keys.length >= MAX_SNAPSHOTS) {
      delete updated[keys[0]];
    }
    updated[messageId] = snapshot;

    set({ snapshots: updated });
  },

  removeSnapshot: (messageId: string) => {
    const { snapshots } = get();
    if (!snapshots[messageId]) return;
    const updated = { ...snapshots };
    delete updated[messageId];
    set({ snapshots: updated });
  },

  transferSnapshot: (fromId: string, toId: string) => {
    const { snapshots } = get();
    const snap = snapshots[fromId];
    if (!snap) return;

    const updated = { ...snapshots };
    delete updated[fromId];
    updated[toId] = snap;
    set({ snapshots: updated });
  },

  markHasChanges: (messageId: string) => {
    const { snapshots } = get();
    const snap = snapshots[messageId];
    if (!snap || snap.hadChanges) return;

    set({
      snapshots: {
        ...snapshots,
        [messageId]: { ...snap, hadChanges: true },
      },
    });
  },

  rewind: (messageId: string) => {
    const { snapshots } = get();
    const snap = snapshots[messageId];
    if (!snap) return;

    const briefStore = useBriefStore.getState();
    const analysisStore = useAnalysisStore.getState();

    // Restore brief (pushes into undo history via setContentStructured)
    if (briefStore.currentBrief) {
      briefStore.setContentStructured({
        paragraphs: structuredClone(snap.brief.paragraphs),
      });
      briefStore.setLawRefs(structuredClone(snap.brief.lawRefs));
    }

    // Restore analysis data
    analysisStore.setDisputes(structuredClone(snap.analysis.disputes));
    analysisStore.setDamages(structuredClone(snap.analysis.damages));
    analysisStore.setTimeline(structuredClone(snap.analysis.timeline));
    analysisStore.setParties(structuredClone(snap.analysis.parties));
  },

  clear: () => set({ snapshots: {} }),
}));
