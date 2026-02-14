import { useState } from 'react'
import type { CaseFile } from '../../../stores/useCaseStore'
import { useTabStore } from '../../../stores/useTabStore'

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

export function FileItem({
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

          {file.status === 'ready' && (
            <button
              onClick={() => openFileTab(file.id, file.filename)}
              className="mt-2 text-[11px] text-ac hover:underline"
            >
              檢視全文 →
            </button>
          )}

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
