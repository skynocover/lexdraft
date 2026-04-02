import { create } from 'zustand';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useCaseStore } from './useCaseStore';
import { forEachCitation, mapParagraphCitations } from '../lib/citationUtils';
import { toChineseExhibitLabel } from '../../shared/chineseNumber';

// Re-export analysis types for backward compatibility
export type { Dispute, Damage, TimelineEvent, Party } from './useAnalysisStore';

export interface Citation {
  id: string;
  label: string;
  type: 'file' | 'law';
  file_id?: string;
  location?: {
    block_index?: number;
    char_start?: number;
    char_end?: number;
  };
  quoted_text: string;
  status: 'confirmed' | 'pending' | 'rejected';
  exhibit_label?: string;
}

export interface TextSegment {
  text: string;
  citations: Citation[];
}

export interface Paragraph {
  id: string;
  section: string;
  subsection: string;
  content_md: string;
  segments?: TextSegment[];
  dispute_id: string | null;
  citations: Citation[];
}

export interface Brief {
  id: string;
  case_id: string;
  template_id: string | null;
  title: string | null;
  content_structured: { paragraphs: Paragraph[] } | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface BriefVersion {
  id: string;
  brief_id: string;
  version_no: number;
  label: string;
  content_structured?: { paragraphs: Paragraph[] } | null;
  created_at: string;
  created_by: 'user' | 'ai' | 'system';
}

export interface LawRef {
  id: string;
  law_name: string;
  article: string;
  full_text: string;
  is_manual: boolean;
}

export interface Exhibit {
  id: string;
  case_id: string;
  file_id: string;
  prefix: string | null;
  number: number | null;
  label: string | null; // computed: prefix + number
  doc_type: string | null;
  description: string | null;
  created_at: string | null;
}

export interface PerBriefState {
  brief: Brief;
  dirty: boolean;
  saving: boolean;
  _history: ContentSnapshot[];
  _future: ContentSnapshot[];
}

type ContentSnapshot = { paragraphs: Paragraph[] };

const MAX_HISTORY = 50;

interface BriefState {
  // ── Source of truth ──
  activeBriefId: string | null;
  briefCache: Record<string, PerBriefState>;

  // ── Backward-compat aliases (derived from briefCache[activeBriefId]) ──
  // Maintained automatically by _syncAliases(). DO NOT set directly.
  currentBrief: Brief | null;
  dirty: boolean;
  saving: boolean;

  // ── Case-level state (unchanged) ──
  briefs: Brief[];
  lawRefs: LawRef[];
  versions: BriefVersion[];
  rebuttalTargetFileIds: string[];
  highlightCitationId: string | null;

  // ── Setters ──
  setCurrentBrief: (brief: Brief | null) => void;
  setBriefs: (briefs: Brief[]) => void;
  setLawRefs: (lawRefs: LawRef[]) => void;
  setRebuttalTargetFileIds: (ids: string[]) => void;
  setHighlightCitationId: (id: string | null) => void;
  setContentStructured: (content: { paragraphs: Paragraph[] }, briefId?: string) => void;
  updateBriefContent: (briefId: string, content: { paragraphs: Paragraph[] }) => void;
  setTitle: (title: string, briefId?: string) => void;

  // ── Loaders ──
  loadBriefs: (caseId: string) => Promise<void>;
  loadBrief: (briefId: string) => Promise<void>;
  loadLawRefs: (caseId: string) => Promise<void>;

  // ── Paragraph mutations ──
  addParagraph: (paragraph: Paragraph, briefId?: string) => void;
  updateParagraph: (paragraphId: string, paragraph: Paragraph, briefId?: string) => void;
  removeParagraph: (paragraphId: string, briefId?: string) => void;

  // ── Citation mutations ──
  updateCitationStatus: (
    paragraphId: string,
    citationId: string,
    status: 'confirmed' | 'rejected',
    briefId?: string,
  ) => void;
  removeCitation: (paragraphId: string, citationId: string, briefId?: string) => void;

  // ── Brief management ──
  removeLawRef: (lawRefId: string) => Promise<void>;
  deleteBrief: (briefId: string) => Promise<void>;
  saveBrief: (briefId?: string) => Promise<void>;

  // ── Undo/redo ──
  undo: (briefId?: string) => void;
  redo: (briefId?: string) => void;
  canUndo: (briefId?: string) => boolean;
  canRedo: (briefId?: string) => boolean;

  // ── Versions ──
  loadVersions: (briefId: string) => Promise<void>;
  createVersion: (label: string, briefId?: string) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
  restoreVersion: (versionId: string, briefId?: string) => Promise<void>;

  // ── Citation stats ──
  citationStats: (briefId?: string) => { confirmed: number; pending: number };

  // ── Cache management ──
  clearBriefCache: () => void;

  // ── Exhibits (unchanged) ──
  exhibits: Exhibit[];
  setExhibits: (exhibits: Exhibit[]) => void;
  loadExhibits: (caseId: string) => Promise<void>;
  addExhibit: (caseId: string, fileId: string, prefix?: string) => Promise<void>;
  updateExhibit: (caseId: string, exhibitId: string, patch: Partial<Exhibit>) => Promise<void>;
  reorderExhibits: (caseId: string, prefix: string, order: string[]) => Promise<void>;
  removeExhibit: (caseId: string, exhibitId: string) => Promise<void>;
  exhibitMap: () => Map<string, string>;
  chineseExhibitMap: () => Map<string, string>;
  syncExhibitLabels: (oldMap: Map<string, string>, newMap: Map<string, string>) => void;
}

const cloneSnapshot = (s: ContentSnapshot): ContentSnapshot => structuredClone(s);

/** Resolve briefId: use provided or fall back to activeBriefId */
const resolveId = (state: { activeBriefId: string | null }, briefId?: string): string | null =>
  briefId ?? state.activeBriefId;

/** Get PerBriefState from cache */
const getCached = (
  state: { briefCache: Record<string, PerBriefState>; activeBriefId: string | null },
  briefId?: string,
): PerBriefState | undefined => {
  const id = resolveId(state, briefId);
  return id ? state.briefCache[id] : undefined;
};

/** Compute backward-compat alias values from cache */
const aliasesFor = (
  cache: Record<string, PerBriefState>,
  activeId: string | null,
): { currentBrief: Brief | null; dirty: boolean; saving: boolean } => {
  const bs = activeId ? cache[activeId] : undefined;
  return {
    currentBrief: bs?.brief ?? null,
    dirty: bs?.dirty ?? false,
    saving: bs?.saving ?? false,
  };
};

/** Update a specific brief in the cache, returning the updated cache */
const patchCache = (
  cache: Record<string, PerBriefState>,
  briefId: string,
  patch: Partial<PerBriefState>,
): Record<string, PerBriefState> => {
  const bs = cache[briefId];
  if (!bs) return cache;
  return { ...cache, [briefId]: { ...bs, ...patch } };
};

/** Build history entry for a brief, clearing future. */
const pushHistory = (bs: PerBriefState): Pick<PerBriefState, '_history' | '_future' | 'dirty'> => {
  const result: Pick<PerBriefState, '_history' | '_future' | 'dirty'> = {
    _future: [],
    dirty: true,
    _history: bs._history,
  };
  if (bs.brief.content_structured) {
    result._history = [
      ...bs._history.slice(-(MAX_HISTORY - 1)),
      cloneSnapshot(bs.brief.content_structured),
    ];
  }
  return result;
};

/** Create a fresh PerBriefState for a brief */
const freshBriefState = (brief: Brief): PerBriefState => ({
  brief,
  dirty: false,
  saving: false,
  _history: [],
  _future: [],
});

export const useBriefStore = create<BriefState>((set, get) => ({
  // ── Source of truth ──
  activeBriefId: null,
  briefCache: {},

  // ── Backward-compat aliases ──
  currentBrief: null,
  dirty: false,
  saving: false,

  // ── Case-level state ──
  briefs: [],
  lawRefs: [],
  versions: [],
  rebuttalTargetFileIds: [],
  highlightCitationId: null,

  // ── setCurrentBrief: add to cache + set active (or clear if null) ──
  setCurrentBrief: (brief) => {
    if (!brief) {
      set({ activeBriefId: null, currentBrief: null, dirty: false, saving: false });
      return;
    }
    const newCache = { ...get().briefCache, [brief.id]: freshBriefState(brief) };
    set({
      activeBriefId: brief.id,
      briefCache: newCache,
      ...aliasesFor(newCache, brief.id),
    });
  },

  setBriefs: (briefs) => set({ briefs }),
  setLawRefs: (lawRefs) => set({ lawRefs }),
  setRebuttalTargetFileIds: (rebuttalTargetFileIds) => set({ rebuttalTargetFileIds }),
  setHighlightCitationId: (highlightCitationId) => set({ highlightCitationId }),

  // ── setContentStructured: update content with undo history ──
  setContentStructured: (content, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs) return;
    const newCache = patchCache(get().briefCache, id, {
      brief: { ...bs.brief, content_structured: content },
      ...pushHistory(bs),
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  // ── updateBriefContent: update content WITHOUT undo history (for editor onChange) ──
  updateBriefContent: (briefId, content) => {
    const bs = get().briefCache[briefId];
    if (!bs) return;
    const newCache = patchCache(get().briefCache, briefId, {
      brief: { ...bs.brief, content_structured: content },
      dirty: true,
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  setTitle: (title, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs) return;
    const newCache = patchCache(get().briefCache, id, {
      brief: { ...bs.brief, title },
      dirty: true,
    });
    set({
      briefCache: newCache,
      briefs: get().briefs.map((b) => (b.id === id ? { ...b, title } : b)),
      ...aliasesFor(newCache, get().activeBriefId),
    });
  },

  // ── Loaders ──
  loadBriefs: async (caseId) => {
    try {
      const briefs = await api.get<Brief[]>(`/cases/${caseId}/briefs`);
      set({ briefs });
    } catch (err) {
      console.error('loadBriefs error:', err);
      toast.error('載入書狀列表失敗', { id: 'case-load' });
    }
  },

  loadBrief: async (briefId) => {
    // Auto-save previous brief if switching to a different one (skip in demo)
    const { activeBriefId, briefCache } = get();
    if (activeBriefId && activeBriefId !== briefId && !useCaseStore.getState().isDemo) {
      const prevBs = briefCache[activeBriefId];
      if (prevBs?.dirty && !prevBs.saving) {
        get()
          .saveBrief(activeBriefId)
          .catch(() => {});
      }
    }

    // Cache hit → just set active
    if (get().briefCache[briefId]) {
      set({ activeBriefId: briefId, ...aliasesFor(get().briefCache, briefId) });
      return;
    }
    // Local briefs array hit → populate cache without API call
    const localBrief = get().briefs.find((b) => b.id === briefId);
    if (localBrief?.content_structured) {
      const newCache = { ...get().briefCache, [briefId]: freshBriefState(localBrief) };
      set({ activeBriefId: briefId, briefCache: newCache, ...aliasesFor(newCache, briefId) });
      return;
    }
    // Cache miss → fetch from API
    try {
      const brief = await api.get<Brief>(`/briefs/${briefId}`);
      const newCache = { ...get().briefCache, [briefId]: freshBriefState(brief) };
      set({
        activeBriefId: briefId,
        briefCache: newCache,
        ...aliasesFor(newCache, briefId),
      });
    } catch (err) {
      console.error('loadBrief error:', err);
      toast.error('載入書狀失敗');
    }
  },

  loadLawRefs: async (caseId) => {
    try {
      const lawRefs = await api.get<LawRef[]>(`/cases/${caseId}/law-refs`);
      set({ lawRefs });
    } catch (err) {
      console.error('loadLawRefs error:', err);
      toast.error('載入法條引用失敗', { id: 'case-load' });
    }
  },

  // ── Paragraph mutations ──
  addParagraph: (paragraph, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs) return;
    const content = bs.brief.content_structured || { paragraphs: [] };
    const newParagraphs = [...content.paragraphs, paragraph];
    const newCache = patchCache(get().briefCache, id, {
      brief: {
        ...bs.brief,
        content_structured: { paragraphs: newParagraphs },
      },
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  updateParagraph: (paragraphId, paragraph, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs?.brief.content_structured) return;
    const newCache = patchCache(get().briefCache, id, {
      brief: {
        ...bs.brief,
        content_structured: {
          paragraphs: bs.brief.content_structured.paragraphs.map((p) =>
            p.id === paragraphId ? paragraph : p,
          ),
        },
      },
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  removeParagraph: (paragraphId, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs?.brief.content_structured) return;
    const newCache = patchCache(get().briefCache, id, {
      brief: {
        ...bs.brief,
        content_structured: {
          paragraphs: bs.brief.content_structured.paragraphs.filter((p) => p.id !== paragraphId),
        },
      },
      ...pushHistory(bs),
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  // ── Citation mutations ──
  updateCitationStatus: (paragraphId, citationId, status, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs?.brief.content_structured) return;
    const newCache = patchCache(get().briefCache, id, {
      brief: {
        ...bs.brief,
        content_structured: {
          paragraphs: mapParagraphCitations(
            bs.brief.content_structured.paragraphs,
            paragraphId,
            (citations) => citations.map((c) => (c.id === citationId ? { ...c, status } : c)),
          ),
        },
      },
      ...pushHistory(bs),
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  removeCitation: (paragraphId, citationId, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs?.brief.content_structured) return;
    const newCache = patchCache(get().briefCache, id, {
      brief: {
        ...bs.brief,
        content_structured: {
          paragraphs: mapParagraphCitations(
            bs.brief.content_structured.paragraphs,
            paragraphId,
            (citations) => citations.filter((c) => c.id !== citationId),
          ),
        },
      },
      ...pushHistory(bs),
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  // ── Undo/redo ──
  undo: (briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs || bs._history.length === 0 || !bs.brief.content_structured) return;

    const prev = bs._history[bs._history.length - 1];
    const currentSnapshot = cloneSnapshot(bs.brief.content_structured);
    const newCache = patchCache(get().briefCache, id, {
      brief: { ...bs.brief, content_structured: prev },
      dirty: true,
      _history: bs._history.slice(0, -1),
      _future: [...bs._future, currentSnapshot],
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  redo: (briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs || bs._future.length === 0 || !bs.brief.content_structured) return;

    const next = bs._future[bs._future.length - 1];
    const currentSnapshot = cloneSnapshot(bs.brief.content_structured);
    const newCache = patchCache(get().briefCache, id, {
      brief: { ...bs.brief, content_structured: next },
      dirty: true,
      _history: [...bs._history, currentSnapshot],
      _future: bs._future.slice(0, -1),
    });
    set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });
  },

  canUndo: (briefId?) => {
    const bs = getCached(get(), briefId);
    return bs ? bs._history.length > 0 : false;
  },

  canRedo: (briefId?) => {
    const bs = getCached(get(), briefId);
    return bs ? bs._future.length > 0 : false;
  },

  // ── Versions ──
  loadVersions: async (briefId) => {
    try {
      const versions = await api.get<BriefVersion[]>(`/briefs/${briefId}/versions`);
      set({ versions });
    } catch (err) {
      console.error('loadVersions error:', err);
      toast.error('載入版本列表失敗');
    }
  },

  createVersion: async (label, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    try {
      await api.post(`/briefs/${id}/versions`, { label });
      toast.success('版本已建立');
      get().loadVersions(id);
    } catch (err) {
      console.error('createVersion error:', err);
      toast.error('建立版本失敗');
    }
  },

  deleteVersion: async (versionId) => {
    try {
      await api.delete(`/brief-versions/${versionId}`);
      set({ versions: get().versions.filter((v) => v.id !== versionId) });
      toast.success('版本已刪除');
    } catch (err) {
      console.error('deleteVersion error:', err);
      toast.error('刪除版本失敗');
    }
  },

  restoreVersion: async (versionId, briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs) return;
    try {
      const version = await api.get<BriefVersion>(`/brief-versions/${versionId}`);
      if (!version.content_structured) return;

      const newCache = patchCache(get().briefCache, id, {
        brief: { ...bs.brief, content_structured: version.content_structured },
        dirty: true,
      });
      set({ briefCache: newCache, ...aliasesFor(newCache, get().activeBriefId) });

      await get().saveBrief(id);
      toast.success('版本已還原');
      get().loadVersions(id);
    } catch (err) {
      console.error('restoreVersion error:', err);
      toast.error('還原版本失敗');
    }
  },

  // ── Brief management ──
  removeLawRef: async (lawRefId) => {
    set({ lawRefs: get().lawRefs.filter((r) => r.id !== lawRefId) });
    try {
      const caseId = useCaseStore.getState().currentCase?.id;
      if (!caseId) return;
      await api.delete(`/cases/${caseId}/law-refs/${lawRefId}`);
    } catch (err) {
      console.error('removeLawRef error:', err);
      toast.error('移除法條失敗');
    }
  },

  deleteBrief: async (briefId) => {
    try {
      await api.delete(`/briefs/${briefId}`);
      const { briefs, briefCache, activeBriefId } = get();
      const newCache = { ...briefCache };
      delete newCache[briefId];
      const newActiveId = activeBriefId === briefId ? null : activeBriefId;
      set({
        briefs: briefs.filter((b) => b.id !== briefId),
        briefCache: newCache,
        activeBriefId: newActiveId,
        ...aliasesFor(newCache, newActiveId),
      });
      toast.success('書狀已刪除');
    } catch (err) {
      console.error('deleteBrief error:', err);
      toast.error('刪除書狀失敗');
    }
  },

  saveBrief: async (briefId?) => {
    const id = resolveId(get(), briefId);
    if (!id) return;
    const bs = get().briefCache[id];
    if (!bs?.brief.content_structured) return;
    if (bs.saving) return;

    const newCacheSaving = patchCache(get().briefCache, id, { saving: true });
    set({ briefCache: newCacheSaving, ...aliasesFor(newCacheSaving, get().activeBriefId) });
    try {
      await api.put(`/briefs/${id}`, {
        title: bs.brief.title,
        content_structured: bs.brief.content_structured,
      });
      const newCacheDone = patchCache(get().briefCache, id, { dirty: false, saving: false });
      set({ briefCache: newCacheDone, ...aliasesFor(newCacheDone, get().activeBriefId) });
    } catch (err) {
      console.error('saveBrief error:', err);
      toast.error('儲存書狀失敗');
      const newCacheErr = patchCache(get().briefCache, id, { saving: false });
      set({ briefCache: newCacheErr, ...aliasesFor(newCacheErr, get().activeBriefId) });
      throw err;
    }
  },

  // ── Citation stats ──
  citationStats: (briefId?) => {
    const bs = getCached(get(), briefId);
    if (!bs?.brief.content_structured) return { confirmed: 0, pending: 0 };
    let confirmed = 0;
    let pending = 0;
    forEachCitation(bs.brief.content_structured.paragraphs, (c) => {
      if (c.status === 'confirmed') confirmed++;
      else if (c.status === 'pending') pending++;
    });
    return { confirmed, pending };
  },

  // ── Cache management ──
  clearBriefCache: () => {
    set({
      activeBriefId: null,
      briefCache: {},
      ...aliasesFor({}, null),
    });
  },

  // ── Exhibits (unchanged) ──
  exhibits: [],
  setExhibits: (exhibits) => set({ exhibits }),

  loadExhibits: async (caseId) => {
    try {
      const exhibits = await api.get<Exhibit[]>(`/cases/${caseId}/exhibits`);
      set({ exhibits });
    } catch (err) {
      console.error('loadExhibits error:', err);
    }
  },

  addExhibit: async (caseId, fileId, prefix?) => {
    try {
      const exhibit = await api.post<Exhibit>(`/cases/${caseId}/exhibits`, {
        file_id: fileId,
        prefix,
      });
      set({ exhibits: [...get().exhibits, exhibit] });
      toast.success('證物已新增');
    } catch (err) {
      console.error('addExhibit error:', err);
      toast.error('新增證物失敗');
    }
  },

  updateExhibit: async (caseId, exhibitId, patch) => {
    set({
      exhibits: get().exhibits.map((e) => (e.id === exhibitId ? { ...e, ...patch } : e)),
    });
    try {
      await api.patch(`/cases/${caseId}/exhibits/${exhibitId}`, patch);
    } catch (err) {
      console.error('updateExhibit error:', err);
      toast.error('更新證物失敗');
      get().loadExhibits(caseId);
    }
  },

  reorderExhibits: async (caseId, prefix, order) => {
    const oldChineseMap = get().chineseExhibitMap();
    const updated = get().exhibits.map((e) => {
      if (e.prefix !== prefix) return e;
      const idx = order.indexOf(e.id);
      if (idx < 0) return e;
      const newNum = idx + 1;
      return { ...e, number: newNum, label: `${prefix}${newNum}` };
    });
    set({ exhibits: updated });
    const newChineseMap = get().chineseExhibitMap();
    get().syncExhibitLabels(oldChineseMap, newChineseMap);
    try {
      const result = await api.patch<Exhibit[]>(`/cases/${caseId}/exhibits/reorder`, {
        prefix,
        order,
      });
      set({ exhibits: result });
    } catch (err) {
      console.error('reorderExhibits error:', err);
      toast.error('排序證物失敗');
      get().loadExhibits(caseId);
    }
  },

  removeExhibit: async (caseId, exhibitId) => {
    const oldChineseMap = get().chineseExhibitMap();
    const prev = get().exhibits;
    set({ exhibits: prev.filter((e) => e.id !== exhibitId) });
    try {
      await api.delete(`/cases/${caseId}/exhibits/${exhibitId}`);
      await get().loadExhibits(caseId);
      const newChineseMap = get().chineseExhibitMap();
      get().syncExhibitLabels(oldChineseMap, newChineseMap);
      toast.success('證物已移除');
    } catch (err) {
      console.error('removeExhibit error:', err);
      toast.error('移除證物失敗');
      set({ exhibits: prev });
    }
  },

  exhibitMap: () => {
    const map = new Map<string, string>();
    for (const e of get().exhibits) {
      if (e.label) map.set(e.file_id, e.label);
    }
    return map;
  },

  chineseExhibitMap: () => {
    const map = new Map<string, string>();
    for (const e of get().exhibits) {
      if (e.prefix && e.number != null) {
        map.set(e.file_id, toChineseExhibitLabel(e.prefix, e.number));
      }
    }
    return map;
  },

  syncExhibitLabels: (oldMap, newMap) => {
    const { briefCache, activeBriefId } = get();

    const changedFileIds = new Set<string>();
    for (const [fileId, oldLabel] of oldMap) {
      const newLabel = newMap.get(fileId);
      if (newLabel && newLabel !== oldLabel) changedFileIds.add(fileId);
    }
    for (const [fileId] of oldMap) {
      if (!newMap.has(fileId)) changedFileIds.add(fileId);
    }
    if (changedFileIds.size === 0) return;

    const labelToPlaceholder = new Map<string, string>();
    const placeholderToNew = new Map<string, string>();
    for (const fileId of changedFileIds) {
      const oldLabel = oldMap.get(fileId);
      const newLabel = newMap.get(fileId);
      if (!oldLabel) continue;
      const placeholder = `\x00EXHIBIT_${fileId}\x00`;
      labelToPlaceholder.set(oldLabel, placeholder);
      if (newLabel) placeholderToNew.set(placeholder, newLabel);
    }

    const replaceText = (text: string): string => {
      let result = text;
      for (const [oldLabel, placeholder] of labelToPlaceholder) {
        result = result.split(oldLabel).join(placeholder);
      }
      for (const [placeholder, newLabel] of placeholderToNew) {
        result = result.split(placeholder).join(newLabel);
      }
      for (const [, placeholder] of labelToPlaceholder) {
        if (!placeholderToNew.has(placeholder)) {
          result = result.split(placeholder).join('');
        }
      }
      return result;
    };

    // Update ALL cached briefs (exhibit labels are case-level)
    let newCache = { ...briefCache };
    for (const [bid, bs] of Object.entries(briefCache)) {
      if (!bs.brief.content_structured) continue;

      const paragraphs = bs.brief.content_structured.paragraphs.map((p) => {
        const hasAffected = [...(p.segments ?? []), { text: '', citations: p.citations }].some(
          (seg) =>
            seg.citations.some(
              (c) => c.type === 'file' && c.file_id && changedFileIds.has(c.file_id),
            ),
        );
        if (!hasAffected) return p;

        const newSegments = p.segments?.map((seg) => ({
          text: replaceText(seg.text),
          citations: seg.citations.map((c) => {
            if (c.type === 'file' && c.file_id && changedFileIds.has(c.file_id)) {
              const nl = newMap.get(c.file_id);
              return { ...c, exhibit_label: nl ?? undefined };
            }
            return c;
          }),
        }));

        return {
          ...p,
          content_md: replaceText(p.content_md),
          segments: newSegments ?? p.segments,
          citations: p.citations.map((c) => {
            if (c.type === 'file' && c.file_id && changedFileIds.has(c.file_id)) {
              const nl = newMap.get(c.file_id);
              return { ...c, exhibit_label: nl ?? undefined };
            }
            return c;
          }),
        };
      });

      newCache = patchCache(newCache, bid, {
        brief: { ...bs.brief, content_structured: { paragraphs } },
        dirty: true,
      });
    }

    set({ briefCache: newCache, ...aliasesFor(newCache, activeBriefId) });
  },
}));
