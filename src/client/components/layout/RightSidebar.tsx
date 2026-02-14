import { useRef, useState } from 'react'
import { useCaseStore, type CaseFile } from '../../stores/useCaseStore'
import { useBriefStore } from '../../stores/useBriefStore'
import { useTabStore } from '../../stores/useTabStore'
import { api } from '../../lib/api'
import { useAuthStore } from '../../stores/useAuthStore'

import { SectionHeader } from './sidebar/SectionHeader'
import { ConfirmDialog } from './sidebar/ConfirmDialog'
import { FileGroup } from './sidebar/FileGroup'
import { LawRefCard } from './sidebar/LawRefCard'
import { LawSearchInput } from './sidebar/LawSearchInput'

type Category = 'ours' | 'theirs' | 'court' | 'evidence' | 'other'

const FILE_GROUPS: { key: Category; label: string; color: string }[] = [
  { key: 'ours', label: '我方書狀', color: 'text-ac' },
  { key: 'theirs', label: '對方書狀', color: 'text-or' },
  { key: 'court', label: '法院文件', color: 'text-cy' },
  { key: 'evidence', label: '證據資料', color: 'text-gr' },
]

export function RightSidebar() {
  const currentCase = useCaseStore((s) => s.currentCase)
  const caseFiles = useCaseStore((s) => s.files)
  const setFiles = useCaseStore((s) => s.setFiles)
  const rebuttalTargetFileIds = useBriefStore((s) => s.rebuttalTargetFileIds)
  const lawRefs = useBriefStore((s) => s.lawRefs)
  const briefs = useBriefStore((s) => s.briefs)
  const deleteBrief = useBriefStore((s) => s.deleteBrief)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openBriefTab = useTabStore((s) => s.openBriefTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const [briefsOpen, setBriefsOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)
  const [lawRefsOpen, setLawRefsOpen] = useState(true)

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

    closeTab(`brief:${briefId}`)
    await deleteBrief(briefId)
  }

  return (
    <aside className="flex w-60 min-h-0 shrink-0 flex-col border-l border-bd bg-bg-1 overflow-y-auto">
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
          count={lawRefs.length}
          countUnit="條"
          open={lawRefsOpen}
          onToggle={() => setLawRefsOpen(!lawRefsOpen)}
        />
        {lawRefsOpen && (
          <div className="px-1 pb-3">
            <div className="mb-2">
              <LawSearchInput />
            </div>
            {lawRefs.length === 0 ? (
              <p className="px-2 text-center text-[11px] text-t3">尚無引用法條</p>
            ) : (
              <div className="space-y-1 px-1">
                {lawRefs.map((ref) => (
                  <LawRefCard key={ref.id} lawRef={ref} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
