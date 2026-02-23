import { useCaseStore, type CaseFile } from '../../../stores/useCaseStore';
import { useBriefStore } from '../../../stores/useBriefStore';
import { api } from '../../../lib/api';
import { FileGroup } from './FileGroup';

type Category = 'ours' | 'theirs' | 'court' | 'evidence' | 'other';

const FILE_GROUPS: { key: Category; label: string }[] = [
  { key: 'ours', label: '我方書狀' },
  { key: 'theirs', label: '對方書狀' },
  { key: 'court', label: '法院文件' },
  { key: 'evidence', label: '證據資料' },
];

export const FilesSection = () => {
  const caseFiles = useCaseStore((s) => s.files);
  const setFiles = useCaseStore((s) => s.setFiles);
  const rebuttalTargetFileIds = useBriefStore((s) => s.rebuttalTargetFileIds);

  const grouped = FILE_GROUPS.map((g) => ({
    ...g,
    files: caseFiles.filter((f) => f.category === g.key),
  }));
  const otherFiles = caseFiles.filter(
    (f) => !f.category || !FILE_GROUPS.some((g) => g.key === f.category),
  );

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

  const handleDropFile = async (fileId: string, newCategory: string) => {
    await handleCategoryChange(fileId, newCategory);
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

      {grouped.map((g) => (
        <FileGroup
          key={g.key}
          label={g.label}
          groupKey={g.key}
          files={g.files}
          rebuttalTargetIds={rebuttalTargetFileIds}
          onDelete={handleDelete}
          onDropFile={handleDropFile}
        />
      ))}

      <FileGroup
        label="其他"
        groupKey="other"
        files={otherFiles}
        rebuttalTargetIds={rebuttalTargetFileIds}
        onDelete={handleDelete}
        onDropFile={handleDropFile}
      />

      {caseFiles.length === 0 && (
        <div className="px-4 py-3">
          <p className="text-xs text-t3">尚無檔案</p>
        </div>
      )}
    </div>
  );
};
