import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '../stores/useAuthStore'
import { useCaseStore, type Case } from '../stores/useCaseStore'
import { api } from '../lib/api'

export function CaseList() {
  const cases = useCaseStore((s) => s.cases)
  const setCases = useCaseStore((s) => s.setCases)
  const clearToken = useAuthStore((s) => s.clearToken)
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Case[]>('/cases')
      .then(setCases)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-bd bg-bg-1 px-4">
        <span className="text-sm font-semibold text-ac">LexDraft</span>
        <button
          onClick={() => { clearToken(); navigate('/login') }}
          className="text-xs text-t3 transition hover:text-t1"
        >
          登出
        </button>
      </header>

      {/* Content */}
      <div className="flex flex-1 items-start justify-center overflow-y-auto p-8">
        <div className="w-full max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-lg font-semibold text-t1">我的案件</h1>
            <button
              onClick={() => navigate('/cases/new')}
              className="rounded bg-ac px-4 py-2 text-sm font-medium text-bg-0 transition hover:opacity-90"
            >
              ＋ 新建案件
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-t3">載入中...</p>
          ) : cases.length === 0 ? (
            <div className="rounded-lg border border-dashed border-bd p-12 text-center">
              <p className="mb-2 text-sm text-t2">尚無案件</p>
              <p className="text-xs text-t3">點擊「新建案件」開始使用</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cases.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/cases/${c.id}`)}
                  className="flex w-full items-center justify-between rounded-lg border border-bd bg-bg-2 p-4 text-left transition hover:border-bd-l hover:bg-bg-h"
                >
                  <div>
                    <p className="text-sm font-medium text-t1">{c.title}</p>
                    <div className="mt-1 flex items-center gap-3">
                      {c.case_number && <span className="text-xs text-t3">{c.case_number}</span>}
                      {c.court && <span className="text-xs text-t3">{c.court}</span>}
                      {c.case_type && (
                        <span className="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] text-t2">{c.case_type}</span>
                      )}
                    </div>
                    {(c.plaintiff || c.defendant) && (
                      <p className="mt-1 text-xs text-t3">
                        {c.plaintiff || '—'} v. {c.defendant || '—'}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-t3">→</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
