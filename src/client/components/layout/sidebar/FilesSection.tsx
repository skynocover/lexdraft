import { useCaseStore, type CaseFile } from '../../../stores/useCaseStore';
import { useBriefStore } from '../../../stores/useBriefStore';
import { api } from '../../../lib/api';
import { FileItem } from './FileItem';

const CATEGORY_ORDER: Record<string, number> = {
  ours: 0,
  theirs: 1,
  court: 2,
  evidence: 3,
  other: 4,
};

export const FilesSection = () => {
  const caseFiles = useCaseStore((s) => s.files);
  const setFiles = useCaseStore((s) => s.setFiles);
  const rebuttalTargetFileIds = useBriefStore((s) => s.rebuttalTargetFileIds);

  const sortedFiles = [...caseFiles].sort((a, b) => {
    const oa = CATEGORY_ORDER[a.category || 'other'] ?? 4;
    const ob = CATEGORY_ORDER[b.category || 'other'] ?? 4;
    return oa - ob;
  });

  const totalFiles = caseFiles.length;
  const readyFiles = caseFiles.filter((f) => f.status === 'ready').length;
  const processingFiles = caseFiles.filter(
    (f) => f.status === 'pending' || f.status === 'processing',
  ).length;

  const handleCategoryChange = async (fileId: string, category: string) => {
    try {
      const updated = await api.put<CaseFile>(`/files/${fileId}`, { category });
      setFiles(caseFiles.map((f) => (f.id === fileId ? { ...f, ...updated } : f)));
    } catch (err) {
      console.error('Category update failed:', err);
    }
  };

  const handleDelete = async (fileId: string) => {
    try {
      await api.delete(`/files/${fileId}`);
      setFiles(caseFiles.filter((f) => f.id !== fileId));
    } catch (err) {
      console.error('Delete failed:', err);
    }
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

      {sortedFiles.length > 0 && (
        <div className="px-3 space-y-0.5">
          {sortedFiles.map((f) => (
            <FileItem
              key={f.id}
              file={f}
              isRebuttalTarget={rebuttalTargetFileIds.includes(f.id)}
              onDelete={handleDelete}
              onCategoryChange={handleCategoryChange}
            />
          ))}
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
