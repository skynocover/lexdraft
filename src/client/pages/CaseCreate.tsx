import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import type { Case } from '../stores/useCaseStore'

export function CaseCreate() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    title: '',
    case_number: '',
    court: '',
    case_type: '',
    plaintiff: '',
    defendant: '',
  })

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('案件名稱為必填')
      return
    }

    setLoading(true)
    setError('')

    try {
      const created = await api.post<Case>('/cases', form)
      navigate(`/cases/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立失敗')
    } finally {
      setLoading(false)
    }
  }

  const caseTypes = ['損害賠償', '給付貨款', '返還價金', '確認之訴', '租賃糾紛', '勞資爭議', '其他']

  return (
    <div className="flex h-screen flex-col bg-bg-0">
      <header className="flex h-12 shrink-0 items-center border-b border-bd bg-bg-1 px-4">
        <button
          onClick={() => navigate('/')}
          className="text-sm font-semibold text-ac hover:opacity-80"
        >
          LexDraft
        </button>
        <span className="mx-2 text-t3">/</span>
        <span className="text-sm text-t2">新建案件</span>
      </header>

      <div className="flex flex-1 items-start justify-center overflow-y-auto p-8">
        <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-5">
          <h1 className="text-lg font-semibold text-t1">新建案件</h1>

          {/* 案件名稱 */}
          <div>
            <label className="mb-1.5 block text-sm text-t2">
              案件名稱 <span className="text-rd">*</span>
            </label>
            <input
              value={form.title}
              onChange={set('title')}
              placeholder="例：艾凡尼公司 v. 朱立家"
              className="w-full rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
              autoFocus
            />
          </div>

          {/* 案號 + 法院 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm text-t2">案號</label>
              <input
                value={form.case_number}
                onChange={set('case_number')}
                placeholder="114年度雄簡字第○○號"
                className="w-full rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-t2">法院</label>
              <input
                value={form.court}
                onChange={set('court')}
                placeholder="高雄地方法院鳳山簡易庭"
                className="w-full rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
              />
            </div>
          </div>

          {/* 案件類型 */}
          <div>
            <label className="mb-1.5 block text-sm text-t2">案件類型</label>
            <select
              value={form.case_type}
              onChange={set('case_type')}
              className="w-full rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none focus:border-ac"
            >
              <option value="">請選擇</option>
              {caseTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* 原告 + 被告 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm text-t2">原告</label>
              <input
                value={form.plaintiff}
                onChange={set('plaintiff')}
                placeholder="原告名稱"
                className="w-full rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-t2">被告</label>
              <input
                value={form.defendant}
                onChange={set('defendant')}
                placeholder="被告名稱"
                className="w-full rounded border border-bd bg-bg-3 px-3 py-2 text-sm text-t1 outline-none placeholder:text-t3 focus:border-ac"
              />
            </div>
          </div>

          {error && <p className="text-sm text-rd">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-ac px-6 py-2 text-sm font-medium text-bg-0 transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? '建立中...' : '建立案件'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded border border-bd px-6 py-2 text-sm text-t2 transition hover:bg-bg-h"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
