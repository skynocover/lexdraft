import { useNavigate } from 'react-router'
import { useAuthStore } from '../../stores/useAuthStore'
import { useCaseStore } from '../../stores/useCaseStore'

export function Header() {
  const clearToken = useAuthStore((s) => s.clearToken)
  const currentCase = useCaseStore((s) => s.currentCase)
  const navigate = useNavigate()

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-bd bg-bg-1 px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="text-sm font-semibold text-ac hover:opacity-80"
        >
          LexDraft
        </button>

        {currentCase && (
          <>
            <span className="text-t3">/</span>
            <span className="text-sm text-t1">{currentCase.title}</span>
            {currentCase.case_number && (
              <span className="text-xs text-t3">({currentCase.case_number})</span>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {currentCase && (
          <button
            className="rounded border border-bd bg-bg-3 px-3 py-1 text-xs text-t2 transition hover:border-bd-l hover:text-t1"
            disabled
          >
            下載 Word
          </button>
        )}
        <button
          onClick={() => { clearToken(); navigate('/login') }}
          className="text-xs text-t3 transition hover:text-t1"
        >
          登出
        </button>
      </div>
    </header>
  )
}
