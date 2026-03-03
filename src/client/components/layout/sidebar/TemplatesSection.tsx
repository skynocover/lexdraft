import { useState, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTemplateStore, type TemplateSummary } from '../../../stores/useTemplateStore';
import { useCaseStore } from '../../../stores/useCaseStore';
import { useTabStore } from '../../../stores/useTabStore';
import { ConfirmDialog } from './ConfirmDialog';

export const TemplatesSection = ({ activeTabId }: { activeTabId: string | null }) => {
  const templates = useTemplateStore((s) => s.templates);
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);
  const currentCase = useCaseStore((s) => s.currentCase);
  const updateCase = useCaseStore((s) => s.updateCase);
  const openTemplateTab = useTabStore((s) => s.openTemplateTab);
  const closeTab = useTabStore((s) => s.closeTab);

  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const selectedTemplateId = currentCase?.template_id ?? null;

  const handleToggleSelect = (templateId: string) => {
    if (!currentCase) return;
    const newId = selectedTemplateId === templateId ? null : templateId;
    // Optimistic update — 先更新 local state，UI 立即反應
    useCaseStore.setState((s) => ({
      currentCase: s.currentCase ? { ...s.currentCase, template_id: newId } : null,
    }));
    // 背景寫入 server（updateCase 內部也會 set，但值相同不會閃爍）
    updateCase(currentCase.id, { template_id: newId }).catch(() => {
      // 失敗時 rollback
      useCaseStore.setState((s) => ({
        currentCase: s.currentCase ? { ...s.currentCase, template_id: selectedTemplateId } : null,
      }));
    });
  };

  const handleCreate = async () => {
    const tpl = await createTemplate();
    openTemplateTab(tpl.id, tpl.title);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const templateId = confirmDelete.id;
    setConfirmDelete(null);

    // 關閉該範本的 tab
    const tabId = `template:${templateId}`;
    const { panels: currentPanels } = useTabStore.getState();
    const ownerPanel = currentPanels.find((p) => p.tabIds.includes(tabId));
    if (ownerPanel) {
      closeTab(tabId, ownerPanel.id);
    }

    // 如果當前案件選了這個範本，清除 template_id
    if (currentCase && selectedTemplateId === templateId) {
      await updateCase(currentCase.id, { template_id: null });
    }

    await deleteTemplate(templateId);
  };

  const sorted = useMemo(
    () =>
      [...templates].sort(
        (a, b) => new Date(b.updated_at ?? '').getTime() - new Date(a.updated_at ?? '').getTime(),
      ),
    [templates],
  );

  return (
    <div>
      {confirmDelete && (
        <ConfirmDialog
          message={`確定要刪除範本「${confirmDelete.title}」嗎？此操作無法復原。`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {sorted.length === 0 ? (
        <div className="px-4 py-3">
          <p className="text-xs text-t3">尚無範本</p>
        </div>
      ) : (
        <div className="space-y-0.5 px-3 py-2">
          {sorted.map((t) => (
            <TemplateItem
              key={t.id}
              template={t}
              isActive={activeTabId === `template:${t.id}`}
              isSelected={selectedTemplateId === t.id}
              onToggleSelect={() => handleToggleSelect(t.id)}
              onOpen={() => openTemplateTab(t.id, t.title)}
              onDelete={() => setConfirmDelete({ id: t.id, title: t.title })}
            />
          ))}
        </div>
      )}

      {/* 新增範本按鈕 */}
      <div className="px-3 pb-2">
        <button
          onClick={handleCreate}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-bd py-2 text-xs text-t3 transition hover:border-ac hover:text-ac"
        >
          <Plus size={14} />
          <span>新增範本</span>
        </button>
      </div>
    </div>
  );
};

const TemplateItem = ({
  template,
  isActive,
  isSelected,
  onToggleSelect,
  onOpen,
  onDelete,
}: {
  template: TemplateSummary;
  isActive: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) => {
  return (
    <div
      className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition ${
        isActive ? 'bg-ac/8' : 'hover:bg-bg-2'
      }`}
    >
      {/* Radio — 最左側，選擇 AI 參考範本 */}
      <button
        onClick={onToggleSelect}
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center"
        title={isSelected ? '取消選擇此範本' : '選為 AI 參考範本'}
      >
        <div
          className={`flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 transition ${
            isSelected ? 'border-gn bg-gn' : 'border-t3 bg-transparent'
          }`}
        >
          {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
        </div>
      </button>

      {/* 標題 — 點擊開啟編輯 */}
      <button onClick={onOpen} className="min-w-0 flex-1">
        <p className={`truncate text-left text-sm font-medium ${isActive ? 'text-ac' : 'text-t1'}`}>
          {template.title}
        </p>
        {isSelected && <span className="text-[10px] text-gn">AI 參考</span>}
      </button>

      {/* 刪除 */}
      <button
        onClick={onDelete}
        className="shrink-0 rounded p-1 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
        title="刪除範本"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};
