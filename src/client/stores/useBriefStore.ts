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

type ContentSnapshot = { paragraphs: Paragraph[] };

const MAX_HISTORY = 50;

interface BriefState {
  currentBrief: Brief | null;
  briefs: Brief[];
  lawRefs: LawRef[];
  versions: BriefVersion[];
  rebuttalTargetFileIds: string[];
  dirty: boolean;
  saving: boolean;
  highlightCitationId: string | null;
  _history: ContentSnapshot[];
  _future: ContentSnapshot[];

  setCurrentBrief: (brief: Brief | null) => void;
  setBriefs: (briefs: Brief[]) => void;
  setLawRefs: (lawRefs: LawRef[]) => void;
  setRebuttalTargetFileIds: (ids: string[]) => void;
  setDirty: (dirty: boolean) => void;
  setHighlightCitationId: (id: string | null) => void;
  setContentStructured: (content: { paragraphs: Paragraph[] }) => void;
  setTitle: (title: string) => void;

  loadBriefs: (caseId: string) => Promise<void>;
  loadBrief: (briefId: string) => Promise<void>;
  loadLawRefs: (caseId: string) => Promise<void>;
  addParagraph: (paragraph: Paragraph) => void;
  updateParagraph: (paragraphId: string, paragraph: Paragraph) => void;
  removeParagraph: (paragraphId: string) => void;
  updateCitationStatus: (
    paragraphId: string,
    citationId: string,
    status: 'confirmed' | 'rejected',
  ) => void;
  removeCitation: (paragraphId: string, citationId: string) => void;
  removeLawRef: (lawRefId: string) => Promise<void>;
  deleteBrief: (briefId: string) => Promise<void>;
  saveBrief: () => Promise<void>;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  loadVersions: (briefId: string) => Promise<void>;
  createVersion: (label: string) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
  restoreVersion: (versionId: string) => Promise<void>;

  citationStats: () => { confirmed: number; pending: number };

  // Exhibits
  exhibits: Exhibit[];
  setExhibits: (exhibits: Exhibit[]) => void;
  loadExhibits: (caseId: string) => Promise<void>;
  addExhibit: (caseId: string, fileId: string, prefix?: string) => Promise<void>;
  updateExhibit: (caseId: string, exhibitId: string, patch: Partial<Exhibit>) => Promise<void>;
  reorderExhibits: (caseId: string, prefix: string, order: string[]) => Promise<void>;
  removeExhibit: (caseId: string, exhibitId: string) => Promise<void>;
  exhibitMap: () => Map<string, string>; // file_id → label (Arabic: 甲1)
  chineseExhibitMap: () => Map<string, string>; // file_id → label (Chinese: 甲證一)
  syncExhibitLabels: (oldMap: Map<string, string>, newMap: Map<string, string>) => void;
}

const cloneSnapshot = (s: ContentSnapshot): ContentSnapshot => structuredClone(s);

/** Capture undo snapshot from current state. Returns partial state to merge into set(). */
const buildHistoryUpdate = (
  currentBrief: Brief | null,
  _history: ContentSnapshot[],
): Pick<BriefState, '_history' | '_future' | 'dirty'> => {
  const result: Pick<BriefState, '_history' | '_future' | 'dirty'> = {
    _future: [],
    dirty: true,
    _history,
  };
  if (currentBrief?.content_structured) {
    result._history = [
      ..._history.slice(-(MAX_HISTORY - 1)),
      cloneSnapshot(currentBrief.content_structured),
    ];
  }
  return result;
};

export const useBriefStore = create<BriefState>((set, get) => ({
  currentBrief: null,
  briefs: [],
  lawRefs: [],
  versions: [],
  rebuttalTargetFileIds: [],
  dirty: false,
  saving: false,
  highlightCitationId: null,
  _history: [],
  _future: [],

  setCurrentBrief: (currentBrief) => set({ currentBrief, _history: [], _future: [] }),
  setBriefs: (briefs) => set({ briefs }),
  setLawRefs: (lawRefs) => set({ lawRefs }),
  setRebuttalTargetFileIds: (rebuttalTargetFileIds) => set({ rebuttalTargetFileIds }),
  setDirty: (dirty) => set({ dirty }),
  setHighlightCitationId: (highlightCitationId) => set({ highlightCitationId }),

  setContentStructured: (content: { paragraphs: Paragraph[] }) => {
    const { currentBrief, _history } = get();
    if (!currentBrief) return;
    set({
      currentBrief: { ...currentBrief, content_structured: content },
      ...buildHistoryUpdate(currentBrief, _history),
    });
  },

  setTitle: (title: string) => {
    const { currentBrief, briefs } = get();
    if (!currentBrief) return;
    set({
      currentBrief: { ...currentBrief, title },
      briefs: briefs.map((b) => (b.id === currentBrief.id ? { ...b, title } : b)),
      dirty: true,
    });
  },

  loadBriefs: async (caseId: string) => {
    try {
      const briefs = await api.get<Brief[]>(`/cases/${caseId}/briefs`);
      set({ briefs });
    } catch (err) {
      console.error('loadBriefs error:', err);
      toast.error('載入書狀列表失敗', { id: 'case-load' });
    }
  },

  loadBrief: async (briefId: string) => {
    // Skip if already loaded
    if (get().currentBrief?.id === briefId) return;
    try {
      const brief = await api.get<Brief>(`/briefs/${briefId}`);
      set({ currentBrief: brief, _history: [], _future: [] });
    } catch (err) {
      console.error('loadBrief error:', err);
      toast.error('載入書狀失敗');
    }
  },

  loadLawRefs: async (caseId: string) => {
    try {
      const lawRefs = await api.get<LawRef[]>(`/cases/${caseId}/law-refs`);
      set({ lawRefs });
    } catch (err) {
      console.error('loadLawRefs error:', err);
      toast.error('載入法條引用失敗', { id: 'case-load' });
    }
  },

  addParagraph: (paragraph: Paragraph) => {
    const { currentBrief } = get();
    if (!currentBrief) return;

    const content = currentBrief.content_structured || { paragraphs: [] };
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: [...content.paragraphs, paragraph],
        },
      },
    });
  },

  updateParagraph: (paragraphId: string, paragraph: Paragraph) => {
    const { currentBrief } = get();
    if (!currentBrief?.content_structured) return;

    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: currentBrief.content_structured.paragraphs.map((p) =>
            p.id === paragraphId ? paragraph : p,
          ),
        },
      },
    });
  },

  removeParagraph: (paragraphId: string) => {
    const { currentBrief, _history } = get();
    if (!currentBrief?.content_structured) return;
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: currentBrief.content_structured.paragraphs.filter(
            (p) => p.id !== paragraphId,
          ),
        },
      },
      ...buildHistoryUpdate(currentBrief, _history),
    });
  },

  updateCitationStatus: (
    paragraphId: string,
    citationId: string,
    status: 'confirmed' | 'rejected',
  ) => {
    const { currentBrief, _history } = get();
    if (!currentBrief?.content_structured) return;
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: mapParagraphCitations(
            currentBrief.content_structured.paragraphs,
            paragraphId,
            (citations) => citations.map((c) => (c.id === citationId ? { ...c, status } : c)),
          ),
        },
      },
      ...buildHistoryUpdate(currentBrief, _history),
    });
  },

  removeCitation: (paragraphId: string, citationId: string) => {
    const { currentBrief, _history } = get();
    if (!currentBrief?.content_structured) return;
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: {
          paragraphs: mapParagraphCitations(
            currentBrief.content_structured.paragraphs,
            paragraphId,
            (citations) => citations.filter((c) => c.id !== citationId),
          ),
        },
      },
      ...buildHistoryUpdate(currentBrief, _history),
    });
  },

  undo: () => {
    const { currentBrief, _history, _future } = get();
    if (_history.length === 0 || !currentBrief?.content_structured) return;

    const prev = _history[_history.length - 1];
    const currentSnapshot = cloneSnapshot(currentBrief.content_structured);
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: prev,
      },
      dirty: true,
      _history: _history.slice(0, -1),
      _future: [..._future, currentSnapshot],
    });
  },

  redo: () => {
    const { currentBrief, _history, _future } = get();
    if (_future.length === 0 || !currentBrief?.content_structured) return;

    const next = _future[_future.length - 1];
    const currentSnapshot = cloneSnapshot(currentBrief.content_structured);
    set({
      currentBrief: {
        ...currentBrief,
        content_structured: next,
      },
      dirty: true,
      _history: [..._history, currentSnapshot],
      _future: _future.slice(0, -1),
    });
  },

  canUndo: () => get()._history.length > 0,
  canRedo: () => get()._future.length > 0,

  loadVersions: async (briefId: string) => {
    try {
      const versions = await api.get<BriefVersion[]>(`/briefs/${briefId}/versions`);
      set({ versions });
    } catch (err) {
      console.error('loadVersions error:', err);
      toast.error('載入版本列表失敗');
    }
  },

  createVersion: async (label: string) => {
    const { currentBrief } = get();
    if (!currentBrief) return;
    try {
      await api.post(`/briefs/${currentBrief.id}/versions`, { label });
      toast.success('版本已建立');
      get().loadVersions(currentBrief.id);
    } catch (err) {
      console.error('createVersion error:', err);
      toast.error('建立版本失敗');
    }
  },

  deleteVersion: async (versionId: string) => {
    try {
      await api.delete(`/brief-versions/${versionId}`);
      set({ versions: get().versions.filter((v) => v.id !== versionId) });
      toast.success('版本已刪除');
    } catch (err) {
      console.error('deleteVersion error:', err);
      toast.error('刪除版本失敗');
    }
  },

  restoreVersion: async (versionId: string) => {
    const { currentBrief } = get();
    if (!currentBrief) return;
    try {
      const version = await api.get<BriefVersion>(`/brief-versions/${versionId}`);
      if (!version.content_structured) return;

      set({
        currentBrief: {
          ...currentBrief,
          content_structured: version.content_structured,
        },
        dirty: true,
      });

      await get().saveBrief();
      toast.success('版本已還原');
      get().loadVersions(currentBrief.id);
    } catch (err) {
      console.error('restoreVersion error:', err);
      toast.error('還原版本失敗');
    }
  },

  removeLawRef: async (lawRefId: string) => {
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

  deleteBrief: async (briefId: string) => {
    try {
      await api.delete(`/briefs/${briefId}`);
      const { briefs, currentBrief } = get();
      set({ briefs: briefs.filter((b) => b.id !== briefId) });
      if (currentBrief?.id === briefId) {
        set({ currentBrief: null });
      }
      toast.success('書狀已刪除');
    } catch (err) {
      console.error('deleteBrief error:', err);
      toast.error('刪除書狀失敗');
    }
  },

  saveBrief: async () => {
    const { currentBrief } = get();
    if (!currentBrief?.content_structured) return;

    set({ saving: true });
    try {
      await api.put(`/briefs/${currentBrief.id}`, {
        title: currentBrief.title,
        content_structured: currentBrief.content_structured,
      });
      set({ dirty: false });
    } catch (err) {
      console.error('saveBrief error:', err);
      toast.error('儲存書狀失敗');
      throw err;
    } finally {
      set({ saving: false });
    }
  },

  citationStats: () => {
    const { currentBrief } = get();
    if (!currentBrief?.content_structured) return { confirmed: 0, pending: 0 };
    let confirmed = 0;
    let pending = 0;
    forEachCitation(currentBrief.content_structured.paragraphs, (c) => {
      if (c.status === 'confirmed') confirmed++;
      else if (c.status === 'pending') pending++;
    });
    return { confirmed, pending };
  },

  // ── Exhibits ──
  exhibits: [],
  setExhibits: (exhibits) => set({ exhibits }),

  loadExhibits: async (caseId: string) => {
    try {
      const exhibits = await api.get<Exhibit[]>(`/cases/${caseId}/exhibits`);
      set({ exhibits });
    } catch (err) {
      console.error('loadExhibits error:', err);
    }
  },

  addExhibit: async (caseId: string, fileId: string, prefix?: string) => {
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

  updateExhibit: async (caseId: string, exhibitId: string, patch: Partial<Exhibit>) => {
    // Optimistic update
    set({
      exhibits: get().exhibits.map((e) => (e.id === exhibitId ? { ...e, ...patch } : e)),
    });
    try {
      await api.patch(`/cases/${caseId}/exhibits/${exhibitId}`, patch);
    } catch (err) {
      console.error('updateExhibit error:', err);
      toast.error('更新證物失敗');
      // Reload to fix state
      get().loadExhibits(caseId);
    }
  },

  reorderExhibits: async (caseId: string, prefix: string, order: string[]) => {
    // Capture old Chinese exhibit map before reorder
    const oldChineseMap = get().chineseExhibitMap();

    // Optimistic update
    const updated = get().exhibits.map((e) => {
      if (e.prefix !== prefix) return e;
      const idx = order.indexOf(e.id);
      if (idx < 0) return e;
      const newNum = idx + 1;
      return { ...e, number: newNum, label: `${prefix}${newNum}` };
    });
    set({ exhibits: updated });

    // Sync exhibit labels in brief text
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

  removeExhibit: async (caseId: string, exhibitId: string) => {
    const oldChineseMap = get().chineseExhibitMap();
    const prev = get().exhibits;
    set({ exhibits: prev.filter((e) => e.id !== exhibitId) });
    try {
      await api.delete(`/cases/${caseId}/exhibits/${exhibitId}`);
      // Reload to get renumbered results
      await get().loadExhibits(caseId);
      // Sync after reload (numbers may have shifted)
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

  syncExhibitLabels: (oldMap: Map<string, string>, newMap: Map<string, string>) => {
    const brief = get().currentBrief;
    if (!brief?.content_structured) return;

    // Find file_ids whose Chinese label changed
    const changedFileIds = new Set<string>();
    for (const [fileId, oldLabel] of oldMap) {
      const newLabel = newMap.get(fileId);
      if (newLabel && newLabel !== oldLabel) changedFileIds.add(fileId);
    }
    // Also handle deleted exhibits (old label exists, no new label)
    for (const [fileId] of oldMap) {
      if (!newMap.has(fileId)) changedFileIds.add(fileId);
    }
    if (changedFileIds.size === 0) return;

    // Build old-label → placeholder and placeholder → new-label maps
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

    // Swap-safe replace: old labels → placeholders → new labels
    const replaceText = (text: string): string => {
      let result = text;
      for (const [oldLabel, placeholder] of labelToPlaceholder) {
        result = result.split(oldLabel).join(placeholder);
      }
      for (const [placeholder, newLabel] of placeholderToNew) {
        result = result.split(placeholder).join(newLabel);
      }
      // Remove placeholders for deleted exhibits (no new label)
      for (const [, placeholder] of labelToPlaceholder) {
        if (!placeholderToNew.has(placeholder)) {
          result = result.split(placeholder).join('');
        }
      }
      return result;
    };

    // Only process paragraphs that have affected file citations
    const paragraphs = brief.content_structured.paragraphs.map((p) => {
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
            const newLabel = newMap.get(c.file_id);
            return { ...c, exhibit_label: newLabel ?? undefined };
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
            const newLabel = newMap.get(c.file_id);
            return { ...c, exhibit_label: newLabel ?? undefined };
          }
          return c;
        }),
      };
    });

    set({
      currentBrief: { ...brief, content_structured: { paragraphs } },
      dirty: true,
    });
  },
}));
