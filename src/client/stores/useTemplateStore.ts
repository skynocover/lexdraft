import { create } from 'zustand';
import { api } from '../lib/api';

export interface TemplateSummary {
  id: string;
  title: string;
  category: string | null;
  is_default: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface Template extends TemplateSummary {
  content_md: string | null;
}

interface TemplateState {
  templates: TemplateSummary[];
  currentTemplate: Template | null;
  dirty: boolean;
  saving: boolean;

  loadTemplates: () => Promise<void>;
  loadTemplate: (id: string) => Promise<void>;
  setContentMd: (content: string) => void;
  setTitle: (title: string) => void;
  saveTemplate: () => Promise<void>;
  createTemplate: (title?: string) => Promise<Template>;
  duplicateTemplate: (sourceId: string) => Promise<Template>;
  deleteTemplate: (id: string) => Promise<void>;
  clearCurrentTemplate: () => void;
}

const toSummary = (t: Template): TemplateSummary => ({
  id: t.id,
  title: t.title,
  category: t.category,
  is_default: t.is_default,
  created_at: t.created_at,
  updated_at: t.updated_at,
});

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  currentTemplate: null,
  dirty: false,
  saving: false,

  loadTemplates: async () => {
    try {
      const result = await api.get<TemplateSummary[]>('/templates');
      set({ templates: result });
    } catch (err) {
      console.error('[useTemplateStore] loadTemplates failed:', err);
    }
  },

  loadTemplate: async (id: string) => {
    try {
      const result = await api.get<Template>(`/templates/${id}`);
      set({ currentTemplate: result, dirty: false });
    } catch (err) {
      console.error('[useTemplateStore] loadTemplate failed:', err);
    }
  },

  setContentMd: (content: string) => {
    const { currentTemplate } = get();
    if (!currentTemplate) return;
    set({
      currentTemplate: {
        ...currentTemplate,
        content_md: content,
      },
      dirty: true,
    });
  },

  setTitle: (title: string) => {
    const { currentTemplate } = get();
    if (!currentTemplate) return;
    set({
      currentTemplate: { ...currentTemplate, title },
      dirty: true,
    });
  },

  saveTemplate: async () => {
    const { currentTemplate, saving } = get();
    if (!currentTemplate || saving) return;
    // 不允許儲存預設範本
    if (currentTemplate.is_default === 1) return;

    set({ saving: true });
    try {
      const updated = await api.put<Template>(`/templates/${currentTemplate.id}`, {
        title: currentTemplate.title,
        content_md: currentTemplate.content_md,
      });
      set((state) => ({
        currentTemplate: updated,
        dirty: false,
        templates: state.templates.map((t) => (t.id === updated.id ? toSummary(updated) : t)),
      }));
    } finally {
      set({ saving: false });
    }
  },

  createTemplate: async (title?: string) => {
    const result = await api.post<Template>('/templates', { title: title || '新範本' });
    set((state) => ({ templates: [...state.templates, toSummary(result)] }));
    return result;
  },

  duplicateTemplate: async (sourceId: string) => {
    const result = await api.post<Template>('/templates', { source_id: sourceId });
    set((state) => ({ templates: [...state.templates, toSummary(result)] }));
    return result;
  },

  deleteTemplate: async (id: string) => {
    await api.delete(`/templates/${id}`);
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
      currentTemplate: state.currentTemplate?.id === id ? null : state.currentTemplate,
    }));
  },

  clearCurrentTemplate: () => {
    set({ currentTemplate: null, dirty: false });
  },
}));
