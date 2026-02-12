import { useRef, useState } from 'react'
import { useCaseStore, type CaseFile } from '../../stores/useCaseStore'
import { api } from '../../lib/api'
import { useAuthStore } from '../../stores/useAuthStore'

type Category = 'ours' | 'theirs' | 'court' | 'evidence' | 'other'

const FILE_GROUPS: { key: Category; label: string; color: string }[] = [
  { key: 'ours', label: '我方書狀', color: 'text-ac' },
  { key: 'theirs', label: '對方書狀', color: 'text-or' },
  { key: 'court', label: '法院文件', color: 'text-cy' },
  { key: 'evidence', label: '證據資料', color: 'text-gr' },
]

const STATUS_ICON: Record<string, string> = {
  pending: '⏳',
  processing: '⏳',
  ready: '✅',
  error: '❌',
}

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function FileItem({
  file,
  groupColor,
  onCategoryChange,
  onDelete,
}: {
  file: CaseFile
  groupColor: string
  onCategoryChange: (id: string, category: string) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = file.summary ? JSON.parse(file.summary) : null

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition hover:bg-bg-h"
      >
        <span className="mt-0.5 text-rd text-[11px]">PDF</span>
        <div className="flex-1 min-w-0">
          <p className="truncate text-xs text-t1">{file.filename}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {file.doc_date && <span className="text-[10px] text-t3">{file.doc_date}</span>}
            <span className="text-[10px] text-t3">{formatSize(file.file_size)}</span>
          </div>
        </div>
        <span className="text-[10px] shrink-0">{STATUS_ICON[file.status] || '⏳'}</span>
      </button>

      {expanded && (
        <div className="mx-2 mb-2 rounded bg-bg-2 p-2">
          {file.status === 'ready' && summary ? (
            <>
              <div className="mb-1.5 flex items-center gap-1">
                <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                  file.category === 'theirs' ? 'bg-or/20 text-or' : 'bg-gr/20 text-gr'
                }`}>
                  {file.category === 'theirs' ? 'AI 重點' : 'AI 摘要'}
                </span>
              </div>
              <p className="text-[11px] leading-4 text-t2">{summary.summary}</p>
              {summary.key_claims?.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {summary.key_claims.map((claim: string, i: number) => (
                    <li key={i} className="text-[10px] text-t3">· {claim}</li>
                  ))}
                </ul>
              )}
            </>
          ) : file.status === 'error' ? (
            <p className="text-[11px] text-rd">處理失敗</p>
          ) : (
            <p className="text-[11px] text-t3">處理中...</p>
          )}

          {/* 手動修改分類 */}
          <div className="mt-2 flex items-center gap-1">
            <span className="text-[10px] text-t3">分類：</span>
            <select
              value={file.category || 'other'}
              onChange={(e) => onCategoryChange(file.id, e.target.value)}
              className="rounded border border-bd bg-bg-3 px-1 py-0.5 text-[10px] text-t2 outline-none"
            >
              <option value="ours">我方</option>
              <option value="theirs">對方</option>
              <option value="court">法院</option>
              <option value="evidence">證據</option>
              <option value="other">其他</option>
            </select>
            <button
              onClick={() => onDelete(file.id)}
              className="ml-auto text-[10px] text-rd hover:underline"
            >
              刪除
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function FileGroup({
  label,
  color,
  files,
  onCategoryChange,
  onDelete,
}: {
  label: string
  color: string
  files: CaseFile[]
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
              onCategoryChange={onCategoryChange}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function RightSidebar() {
  const currentCase = useCaseStore((s) => s.currentCase)
  const caseFiles = useCaseStore((s) => s.files)
  const setFiles = useCaseStore((s) => s.setFiles)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const grouped = FILE_GROUPS.map((g) => ({
    ...g,
    files: caseFiles.filter((f) => f.category === g.key),
  }))
  const otherFiles = caseFiles.filter(
    (f) => !f.category || !FILE_GROUPS.some((g) => g.key === f.category),
  )

  const totalFiles = caseFiles.length
  const readyFiles = caseFiles.filter((f) => f.status === 'ready').length
  const processingFiles = caseFiles.filter((f) => f.status === 'pending' || f.status === 'processing').length

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || !currentCase) return

    setUploading(true)
    for (const file of Array.from(fileList)) {
      if (file.type !== 'application/pdf') continue
      if (file.size > 20 * 1024 * 1024) continue

      const formData = new FormData()
      formData.append('file', file)

      const token = useAuthStore.getState().token
      try {
        const res = await fetch(`/api/cases/${currentCase.id}/files`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
        if (res.ok) {
          const newFile = await res.json() as CaseFile
          setFiles([...useCaseStore.getState().files, newFile])
        }
      } catch (err) {
        console.error('Upload failed:', err)
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCategoryChange = async (fileId: string, category: string) => {
    try {
      const updated = await api.put<CaseFile>(`/files/${fileId}`, { category })
      setFiles(caseFiles.map((f) => (f.id === fileId ? { ...f, ...updated } : f)))
    } catch (err) {
      console.error('Category update failed:', err)
    }
  }

  const handleDelete = async (fileId: string) => {
    try {
      await api.delete(`/files/${fileId}`)
      setFiles(caseFiles.filter((f) => f.id !== fileId))
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-l border-bd bg-bg-1 overflow-y-auto">
      {/* 案件卷宗區塊 */}
      <div className="border-b border-bd">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-medium text-t2">案件卷宗</span>
          <span className="text-[10px] text-t3">{totalFiles} 個檔案</span>
        </div>

        {/* 處理進度 */}
        {processingFiles > 0 && (
          <div className="mx-3 mb-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-yl">處理中...</span>
              <span className="text-[10px] text-t3">{readyFiles}/{totalFiles}</span>
            </div>
            <div className="h-1 rounded-full bg-bg-3">
              <div
                className="h-1 rounded-full bg-ac transition-all"
                style={{ width: totalFiles > 0 ? `${(readyFiles / totalFiles) * 100}%` : '0%' }}
              />
            </div>
          </div>
        )}

        {/* 分類群組 */}
        {grouped.map((g) => (
          <FileGroup
            key={g.key}
            label={g.label}
            color={g.color}
            files={g.files}
            onCategoryChange={handleCategoryChange}
            onDelete={handleDelete}
          />
        ))}

        {/* 未分類 */}
        {otherFiles.length > 0 && (
          <FileGroup
            label="其他"
            color="text-t3"
            files={otherFiles}
            onCategoryChange={handleCategoryChange}
            onDelete={handleDelete}
          />
        )}

        {/* 上傳入口 */}
        <div className="px-3 pb-3 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex w-full items-center justify-center rounded border border-dashed border-bd py-4 text-xs text-t3 transition hover:border-ac hover:text-ac disabled:opacity-50"
          >
            {uploading ? '上傳中...' : '＋ 上傳（自動分類）'}
          </button>
        </div>
      </div>

      {/* 法條引用區塊 */}
      <div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-xs font-medium text-t2">法條引用</span>
          <span className="text-[10px] text-t3">0 條</span>
        </div>
        <div className="px-3 pb-3">
          <p className="text-center text-[11px] text-t3">尚無引用法條</p>
        </div>
      </div>
    </aside>
  )
}
