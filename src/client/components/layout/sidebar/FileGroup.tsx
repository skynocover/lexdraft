import { useState } from "react";
import type { CaseFile } from "../../../stores/useCaseStore";
import { FileItem } from "./FileItem";

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
    const fileId = e.dataTransfer.getData("text/file-id");
    if (fileId) {
      onDropFile(fileId, groupKey);
    }
  };

  return (
    <div
      className={`${dragOver ? "rounded bg-ac/5" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 transition hover:bg-bg-h"
      >
        <span className="text-[10px] text-t3">
          {open ? "\u25BE" : "\u25B8"}
        </span>
        <span className="text-[11px] font-semibold tracking-wide text-t1">
          {label}
        </span>
        <span className="text-[10px] text-t3">({files.length})</span>
      </button>
      {open && files.length > 0 && (
        <div className="pb-1 pl-2">
          {files.map((f) => (
            <FileItem
              key={f.id}
              file={f}
              isRebuttalTarget={rebuttalTargetIds.includes(f.id)}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
      {dragOver && files.length === 0 && open && (
        <div className="mx-3 mb-2 rounded border border-dashed border-ac/40 py-2 text-center text-[10px] text-ac/60">
          拖曳至此分類
        </div>
      )}
    </div>
  );
}
