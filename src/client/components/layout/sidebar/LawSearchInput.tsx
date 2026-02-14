import { useState, useRef, useCallback } from 'react'
import { api } from '../../../lib/api'

interface SearchResult {
  _id: string
  law_name: string
  article_no: string
  content: string
  pcode: string
  nature: string
  score: number
}

export function LawSearchInput() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const data = await api.post<{ results: SearchResult[] }>('/law/search', { query: q, limit: 8 })
      setResults(data.results)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(v), 300)
  }

  return (
    <div className="px-2">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="搜尋法條..."
          className="w-full rounded border border-bd bg-bg-2 px-2 py-1.5 text-xs text-t1 placeholder:text-t3 outline-none focus:border-ac"
        />
        {searching && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-t3">...</span>
        )}
      </div>
      {results.length > 0 && (
        <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded border border-bd bg-bg-2 p-1">
          {results.map((r) => (
            <div
              key={r._id}
              className="rounded px-2 py-1.5 text-left transition hover:bg-bg-h cursor-default"
            >
              <p className="text-xs font-medium text-t1">{r.law_name} {r.article_no}</p>
              <p className="mt-0.5 text-[10px] leading-3.5 text-t3 line-clamp-2">{r.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
