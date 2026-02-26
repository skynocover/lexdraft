import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, Plus, Scale } from 'lucide-react';
import { useTabStore, type LawSearchResult } from '../../stores/useTabStore';
import { useBriefStore, type LawRef } from '../../stores/useBriefStore';
import { useCaseStore } from '../../stores/useCaseStore';
import { api } from '../../lib/api';
import { Accordion } from '../ui/accordion';
import { LawSearchResultItem } from './LawSearchResultItem';

interface LawSearchViewerProps {
  searchId: string;
  initialQuery: string;
  cachedResults: LawSearchResult[];
  cachedSelected: string[];
}

export const LawSearchViewer = ({
  searchId,
  initialQuery,
  cachedResults,
  cachedSelected,
}: LawSearchViewerProps) => {
  const updateLawSearchTabQuery = useTabStore((s) => s.updateLawSearchTabQuery);
  const updateLawSearchTabCache = useTabStore((s) => s.updateLawSearchTabCache);
  const setLawRefs = useBriefStore((s) => s.setLawRefs);
  const lawRefs = useBriefStore((s) => s.lawRefs);
  const currentCase = useCaseStore((s) => s.currentCase);

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<LawSearchResult[]>(cachedResults);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(cachedSelected));
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef(results);
  const selectedRef = useRef(selected);
  resultsRef.current = results;
  selectedRef.current = selected;

  const existingIds = useMemo(() => new Set(lawRefs.map((r) => r.id)), [lawRefs]);

  // Sync cache back to store only on unmount
  useEffect(() => {
    return () => {
      updateLawSearchTabCache(searchId, resultsRef.current, [...selectedRef.current]);
    };
  }, [searchId, updateLawSearchTabCache]);

  const doSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const data = await api.post<{ results: LawSearchResult[] }>('/law/search', {
          query: trimmed,
          limit: 20,
        });
        setResults(data.results);
        setSelected(new Set());
        updateLawSearchTabQuery(searchId, trimmed);
        updateLawSearchTabCache(searchId, data.results, []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [searchId, updateLawSearchTabQuery, updateLawSearchTabCache],
  );

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch(query);
    }
  };

  const handleToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (!currentCase || selected.size === 0) return;
    setAdding(true);
    const toAdd = results.filter((r) => selected.has(r._id) && !existingIds.has(r._id));
    try {
      const updatedRefs = await api.post<LawRef[]>(`/cases/${currentCase.id}/law-refs`, {
        items: toAdd.map((r) => ({
          id: r._id,
          law_name: r.law_name,
          article: r.article_no,
          full_text: r.content,
        })),
      });
      setLawRefs(updatedRefs);
      setSelected(new Set());
    } catch (err) {
      console.error('Add law refs failed:', err);
    } finally {
      setAdding(false);
    }
  };

  const selectableCount = results.filter(
    (r) => selected.has(r._id) && !existingIds.has(r._id),
  ).length;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-0">
      {/* Search bar */}
      <div className="flex items-center gap-3 border-b border-bd px-6 py-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-t3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="法規名稱、條號或關鍵字..."
            className="w-full rounded-lg border border-bd bg-bg-1 py-2 pl-9 pr-4 text-sm text-t1 placeholder:text-t3 outline-none focus:border-ac"
          />
        </div>
        <button
          onClick={() => doSearch(query)}
          disabled={searching || !query.trim()}
          className="shrink-0 rounded-lg bg-ac px-4 py-2 text-sm font-medium text-white transition hover:bg-ac/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {searching ? '搜尋中...' : '搜尋'}
        </button>

        {/* Result count + add button */}
        {results.length > 0 && (
          <>
            <span className="shrink-0 text-xs text-t3">{results.length} 筆結果</span>
            <button
              onClick={handleAdd}
              disabled={selectableCount === 0 || adding}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-bd px-3 py-2 text-sm text-t2 transition hover:bg-bg-h hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={14} />
              {adding
                ? '加入中...'
                : selectableCount > 0
                  ? `加入 ${selectableCount} 條`
                  : '加入案件'}
            </button>
          </>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results.length > 0 ? (
          <div className="mx-auto max-w-200 px-6 py-4">
            <Accordion type="multiple">
              {results.map((r) => (
                <LawSearchResultItem
                  key={r._id}
                  result={r}
                  isSelected={selected.has(r._id)}
                  alreadyAdded={existingIds.has(r._id)}
                  onToggle={handleToggle}
                />
              ))}
            </Accordion>
          </div>
        ) : searching ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-t3">搜尋中...</p>
          </div>
        ) : query.trim() && !searching ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-t3">未找到相關法條</p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pu/10">
              <Scale size={22} className="text-pu" />
            </div>
            <p className="text-sm text-t3">輸入法規名稱、條號或關鍵字進行搜尋</p>
          </div>
        )}
      </div>
    </div>
  );
};
