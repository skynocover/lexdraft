import { useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useCaseStore, type CaseFile } from '../../../stores/useCaseStore';
import { useBriefStore, type Exhibit } from '../../../stores/useBriefStore';
import { api } from '../../../lib/api';
import { FileItem, SortableFileItem } from './FileItem';

const CATEGORY_ORDER: Record<string, number> = {
  brief: 0,
  court: 1,
  other: 2,
};

type FileWithExhibit = { file: CaseFile; exhibit?: Exhibit };

const groupFiles = (
  files: CaseFile[],
  exhibits: Exhibit[],
): { 甲證: FileWithExhibit[]; 乙證: FileWithExhibit[]; unassigned: FileWithExhibit[] } => {
  const exhibitByFileId = new Map(exhibits.map((e) => [e.file_id, e]));

  const groups = {
    甲證: [] as FileWithExhibit[],
    乙證: [] as FileWithExhibit[],
    unassigned: [] as FileWithExhibit[],
  };

  for (const file of files) {
    const exhibit = exhibitByFileId.get(file.id);
    if (exhibit?.prefix === '甲證') {
      groups['甲證'].push({ file, exhibit });
    } else if (exhibit?.prefix === '乙證') {
      groups['乙證'].push({ file, exhibit });
    } else {
      groups.unassigned.push({ file });
    }
  }

  groups['甲證'].sort((a, b) => (a.exhibit?.number ?? 0) - (b.exhibit?.number ?? 0));
  groups['乙證'].sort((a, b) => (a.exhibit?.number ?? 0) - (b.exhibit?.number ?? 0));
  groups.unassigned.sort(
    (a, b) =>
      (CATEGORY_ORDER[a.file.category || 'other'] ?? 4) -
      (CATEGORY_ORDER[b.file.category || 'other'] ?? 4),
  );

  return groups;
};

export const FilesSection = () => {
  const caseFiles = useCaseStore((s) => s.files);
  const setFiles = useCaseStore((s) => s.setFiles);
  const currentCase = useCaseStore((s) => s.currentCase);
  const rebuttalTargetFileIds = useBriefStore((s) => s.rebuttalTargetFileIds);
  const exhibits = useBriefStore((s) => s.exhibits);
  const reorderExhibits = useBriefStore((s) => s.reorderExhibits);
  const loadExhibits = useBriefStore((s) => s.loadExhibits);

  const caseId = currentCase?.id;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const groups = useMemo(() => groupFiles(caseFiles, exhibits), [caseFiles, exhibits]);
  const hasExhibits = groups['甲證'].length > 0 || groups['乙證'].length > 0;

  const totalFiles = caseFiles.length;
  const readyFiles = caseFiles.filter((f) => f.status === 'ready').length;
  const processingFiles = caseFiles.filter(
    (f) => f.status === 'pending' || f.status === 'processing',
  ).length;

  const handleCategoryChange = useCallback(
    async (fileId: string, category: string) => {
      try {
        const updated = await api.put<CaseFile>(`/files/${fileId}`, { category });
        setFiles(caseFiles.map((f) => (f.id === fileId ? { ...f, ...updated } : f)));
        if (caseId) {
          await loadExhibits(caseId);
        }
      } catch (err) {
        console.error('Category update failed:', err);
        toast.error('更新分類失敗');
      }
    },
    [caseFiles, setFiles, caseId, loadExhibits],
  );

  const handleDelete = useCallback(
    async (fileId: string) => {
      try {
        await api.delete(`/files/${fileId}`);
        setFiles(caseFiles.filter((f) => f.id !== fileId));
        toast.success('檔案已刪除');
      } catch (err) {
        console.error('Delete failed:', err);
        toast.error('刪除檔案失敗');
      }
    },
    [caseFiles, setFiles],
  );

  const handleDragEnd = useCallback(
    (prefix: string, ids: string[]) => (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !caseId) return;

      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex < 0 || newIndex < 0) return;

      const newOrder = [...ids];
      newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, active.id as string);

      reorderExhibits(caseId, prefix, newOrder);
    },
    [caseId, reorderExhibits],
  );

  const renderGroup = (prefix: string, label: string, items: FileWithExhibit[]) => {
    if (items.length === 0) return null;

    const exhibitIds = items.map((item) => item.exhibit!.id);

    return (
      <div key={prefix} className="mb-2">
        <p className="mb-1 px-3 text-[11px] font-medium text-t3">{label}</p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd(prefix, exhibitIds)}
        >
          <SortableContext items={exhibitIds} strategy={verticalListSortingStrategy}>
            <div className="px-3 space-y-0.5">
              {items.map(({ file, exhibit }) => (
                <SortableFileItem
                  key={file.id}
                  file={file}
                  exhibit={exhibit!}
                  isRebuttalTarget={rebuttalTargetFileIds.includes(file.id)}
                  onDelete={handleDelete}
                  onCategoryChange={handleCategoryChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    );
  };

  return (
    <div>
      {processingFiles > 0 && (
        <div className="mx-4 mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-yl">處理中...</span>
            <span className="text-xs text-t3">
              {readyFiles}/{totalFiles}
            </span>
          </div>
          <div className="h-1 rounded-full bg-bg-3">
            <div
              className="h-1 rounded-full bg-ac transition-all"
              style={{
                width: totalFiles > 0 ? `${(readyFiles / totalFiles) * 100}%` : '0%',
              }}
            />
          </div>
        </div>
      )}

      {hasExhibits && (
        <>
          {renderGroup('甲證', '甲方證物', groups['甲證'])}
          {renderGroup('乙證', '乙方證物', groups['乙證'])}
        </>
      )}

      {groups.unassigned.length > 0 && (
        <div className="mb-2">
          {hasExhibits && <p className="mb-1 px-3 text-[11px] font-medium text-t3">未編號</p>}
          <div className="px-3 space-y-0.5">
            {groups.unassigned.map(({ file }) => (
              <FileItem
                key={file.id}
                file={file}
                isRebuttalTarget={rebuttalTargetFileIds.includes(file.id)}
                onDelete={handleDelete}
                onCategoryChange={handleCategoryChange}
              />
            ))}
          </div>
        </div>
      )}

      {caseFiles.length === 0 && (
        <div className="px-4 py-3">
          <p className="text-xs text-t3">尚無檔案</p>
        </div>
      )}
    </div>
  );
};
