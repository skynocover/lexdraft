import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuthStore } from '../stores/useAuthStore'

export function TokenLogin() {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setToken = useAuthStore((s) => s.setToken)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${input.trim()}` },
      })

      if (res.ok) {
        setToken(input.trim())
        navigate('/', { replace: true })
      } else {
        setError('Token 無效，請重新輸入')
      }
    } catch {
      setError('無法連線到伺服器')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg-0">
      <div className="w-full max-w-sm rounded-lg border border-bd bg-bg-1 p-8">
        <h1 className="mb-2 text-xl font-semibold text-t1">LexDraft</h1>
        <p className="mb-6 text-sm text-t3">法律書狀撰寫助手</p>

        <form onSubmit={handleSubmit}>
          <label className="mb-2 block text-sm text-t2">存取 Token</label>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="輸入 Token..."
            className="mb-4 w-full rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
            autoFocus
          />

          {error && (
            <p className="mb-4 text-sm text-rd">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-full rounded bg-ac px-4 py-2 text-sm font-medium text-bg-0 transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? '驗證中...' : '登入'}
          </button>
        </form>
      </div>
    </div>
  )
}
