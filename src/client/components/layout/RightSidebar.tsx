import { useRef, useState } from 'react'
import { useCaseStore, type CaseFile } from '../../stores/useCaseStore'
import { useBriefStore } from '../../stores/useBriefStore'
import { useTabStore } from '../../stores/useTabStore'
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

/* ── 確認刪除彈窗 ── */
function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-72 rounded-lg border border-bd bg-bg-1 p-4 shadow-xl">
        <p className="mb-4 text-sm text-t1">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-bd px-3 py-1 text-xs text-t2 transition hover:bg-bg-h"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-rd px-3 py-1 text-xs text-white transition hover:bg-rd/80"
          >
            刪除
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── 可折疊區段標題 ── */
function SectionHeader({
  label,
  count,
  countUnit,
  open,
  onToggle,
}: {
  label: string
  count: number
  countUnit: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between px-3 py-2 transition hover:bg-bg-h"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-t3">{open ? '▾' : '▸'}</span>
        <span className="text-xs font-medium text-t2">{label}</span>
      </div>
      <span className="text-[10px] text-t3">{count} {countUnit}</span>
    </button>
  )
}

/* ── 檔案項目 ── */
function FileItem({
  file,
  groupColor,
  isRebuttalTarget,
  onCategoryChange,
  onDelete,
}: {
  file: CaseFile
  groupColor: string
  isRebuttalTarget: boolean
  onCategoryChange: (id: string, category: string) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const openFileTab = useTabStore((s) => s.openFileTab)
  const summary = file.summary ? JSON.parse(file.summary) : null

  const activeTabId = useTabStore((s) => s.activeTabId)
  const isFileActive = activeTabId === `file:${file.id}`

  const handleClick = () => {
    if (file.status === 'ready') {
      openFileTab(file.id, file.filename)
    }
  }

  return (
    <div className="mb-1">
      <div
        className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition hover:bg-bg-h ${
          isRebuttalTarget ? 'bg-yl/10' : isFileActive ? 'bg-ac/10' : ''
        }`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          className="mt-1 shrink-0 text-[10px] text-t3"
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button onClick={handleClick} className="flex flex-1 items-start gap-2 min-w-0">
          <span className="mt-0.5 text-rd text-[11px]">PDF</span>
          <div className="flex-1 min-w-0">
            <p className={`truncate text-xs ${isRebuttalTarget ? 'text-yl font-medium' : isFileActive ? 'text-ac font-medium' : 'text-t1'}`}>
              {isRebuttalTarget && '* '}{file.filename}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {file.doc_date && <span className="text-[10px] text-t3">{file.doc_date}</span>}
              <span className="text-[10px] text-t3">{formatSize(file.file_size)}</span>
            </div>
          </div>
        </button>
        <span className="text-[10px] shrink-0 mt-0.5">{STATUS_ICON[file.status] || '⏳'}</span>
      </div>

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

          {/* 檢視全文按鈕 */}
          {file.status === 'ready' && (
            <button
              onClick={() => openFileTab(file.id, file.filename)}
              className="mt-2 text-[11px] text-ac hover:underline"
            >
              檢視全文 →
            </button>
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

/* ── 檔案分類群組 ── */
function FileGroup({
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

/* ── 主元件 ── */
export function RightSidebar() {
  const currentCase = useCaseStore((s) => s.currentCase)
  const caseFiles = useCaseStore((s) => s.files)
  const setFiles = useCaseStore((s) => s.setFiles)
  const rebuttalTargetFileIds = useBriefStore((s) => s.rebuttalTargetFileIds)
  const briefs = useBriefStore((s) => s.briefs)
  const deleteBrief = useBriefStore((s) => s.deleteBrief)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openBriefTab = useTabStore((s) => s.openBriefTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // 折疊狀態
  const [briefsOpen, setBriefsOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)
  const [lawRefsOpen, setLawRefsOpen] = useState(true)

  // 刪除確認彈窗
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)

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

  const handleDeleteBrief = async () => {
    if (!confirmDelete) return
    const briefId = confirmDelete.id
    setConfirmDelete(null)

    // 關閉對應 tab
    closeTab(`brief:${briefId}`)
    await deleteBrief(briefId)
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-l border-bd bg-bg-1 overflow-y-auto">
      {/* 刪除確認彈窗 */}
      {confirmDelete && (
        <ConfirmDialog
          message={`確定要刪除「${confirmDelete.title}」嗎？此操作無法復原。`}
          onConfirm={handleDeleteBrief}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* 書狀草稿區塊 */}
      <div className="border-b border-bd">
        <SectionHeader
          label="書狀草稿"
          count={briefs.length}
          countUnit="份"
          open={briefsOpen}
          onToggle={() => setBriefsOpen(!briefsOpen)}
        />
        {briefsOpen && (
          briefs.length === 0 ? (
            <div className="px-3 pb-3">
              <p className="text-center text-[11px] text-t3">尚無書狀</p>
            </div>
          ) : (
            <div className="px-1 pb-2">
              {briefs.map((b) => {
                const tabId = `brief:${b.id}`
                const isActive = activeTabId === tabId
                const title = b.title || b.brief_type
                return (
                  <div
                    key={b.id}
                    className={`group flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition ${
                      isActive ? 'bg-ac/10 text-ac' : 'hover:bg-bg-h'
                    }`}
                  >
                    <button
                      onClick={() => openBriefTab(b.id, title)}
                      className="flex flex-1 items-start gap-2 min-w-0"
                    >
                      <span className={`mt-0.5 text-[11px] ${isActive ? 'text-ac' : 'text-ac/60'}`}>DOC</span>
                      <div className="flex-1 min-w-0">
                        <p className={`truncate text-xs ${isActive ? 'text-ac font-medium' : 'text-t1'}`}>
                          {b.title || '書狀'}
                        </p>
                        <span className="text-[10px] text-t3">{{ complaint: '起訴狀', defense: '答辯狀', preparation: '準備書狀', appeal: '上訴狀' }[b.brief_type] || b.brief_type}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => setConfirmDelete({ id: b.id, title })}
                      className="mt-0.5 shrink-0 rounded p-1 text-t3 opacity-0 transition hover:text-rd group-hover:opacity-100"
                      title="刪除書狀"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* 案件卷宗區塊 */}
      <div className="border-b border-bd">
        <SectionHeader
          label="案件卷宗"
          count={totalFiles}
          countUnit="個檔案"
          open={filesOpen}
          onToggle={() => setFilesOpen(!filesOpen)}
        />
        {filesOpen && (
          <>
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
                rebuttalTargetIds={rebuttalTargetFileIds}
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
                rebuttalTargetIds={rebuttalTargetFileIds}
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
          </>
        )}
      </div>

      {/* 法條引用區塊 */}
      <div>
        <SectionHeader
          label="法條引用"
          count={0}
          countUnit="條"
          open={lawRefsOpen}
          onToggle={() => setLawRefsOpen(!lawRefsOpen)}
        />
        {lawRefsOpen && (
          <div className="px-3 pb-3">
            <p className="text-center text-[11px] text-t3">尚無引用法條</p>
          </div>
        )}
      </div>
    </aside>
  )
}
