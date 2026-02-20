import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CaseFile } from '../../../stores/useCaseStore';
import { FileItem } from './FileItem';

export function FileGroup({
  label,
  groupKey,
  files,
  rebuttalTargetIds,
  onDelete,
  onDropFile,
}: {
  label: string;
  groupKey: string;
  files: CaseFile[];
  rebuttalTargetIds: string[];
  onDelete: (id: string) => void;
  onDropFile: (fileId: string, newCategory: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const fileId = e.dataTransfer.getData('text/file-id');
    if (fileId) {
      onDropFile(fileId, groupKey);
    }
  };

  return (
    <div
      className={`border-b border-bd last:border-b-0 ${dragOver ? 'bg-ac/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-4 pt-3 pb-1 transition hover:bg-bg-h"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-t3" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-t3" />
        )}
        <span className="text-xs font-semibold text-t2">{label}</span>
        <span className="text-xs font-normal text-t3">({files.length})</span>
      </button>

      {open && (
        <>
          {files.length > 0 && (
            <div className="px-3 pb-2 space-y-0.5">
              {files.map((f) => (
                <FileItem
                  key={f.id}
                  file={f}
                  groupKey={groupKey}
                  isRebuttalTarget={rebuttalTargetIds.includes(f.id)}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
          {dragOver && files.length === 0 && (
            <div className="mx-4 mb-3 rounded-lg border border-dashed border-ac/40 py-3 text-center text-sm text-ac/60">
              拖曳至此分類
            </div>
          )}
        </>
      )}
    </div>
  );
}
