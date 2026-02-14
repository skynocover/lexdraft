import { useState } from 'react'
import type { CaseFile } from '../../../stores/useCaseStore'
import { FileItem } from './FileItem'

export function FileGroup({
  label,
  color,
  files,
  rebuttalTargetIds,
  onCategoryChange,
  onDelete,
}: {
  label: string
  color: string
  files: CaseFile[]
  rebuttalTargetIds: string[]
  onCategoryChange: (id: string, category: string) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 transition hover:bg-bg-h"
      >
        <span className="text-[10px] text-t3">{open ? '▾' : '▸'}</span>
        <span className={`text-xs font-medium ${color}`}>{label}</span>
        <span className="text-[10px] text-t3">({files.length})</span>
      </button>
      {open && files.length > 0 && (
        <div className="px-1">
          {files.map((f) => (
            <FileItem
              key={f.id}
              file={f}
              groupColor={color}
              isRebuttalTarget={rebuttalTargetIds.includes(f.id)}
              onCategoryChange={onCategoryChange}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
