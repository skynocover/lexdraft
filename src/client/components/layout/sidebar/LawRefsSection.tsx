import { useState, useMemo, useRef, useCallback } from 'react';
import { Search, Check, X } from 'lucide-react';
import { useBriefStore, type LawRef } from '../../../stores/useBriefStore';
import { useCaseStore } from '../../../stores/useCaseStore';
import { forEachCitation } from '../../../lib/citationUtils';
import { LawRefCard } from './LawRefCard';
import { api } from '../../../lib/api';

interface SearchResult {
  _id: string;
  law_name: string;
  article_no: string;
  content: string;
  pcode: string;
  nature: string;
  score: number;
}

export const LawRefsSection = () => {
  const lawRefs = useBriefStore((s) => s.lawRefs);
  const currentBrief = useBriefStore((s) => s.currentBrief);
  const removeLawRef = useBriefStore((s) => s.removeLawRef);
  const setLawRefs = useBriefStore((s) => s.setLawRefs);
  const currentCase = useCaseStore((s) => s.currentCase);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingIds = new Set(lawRefs.map((r) => r.id));

  const citedLabels = useMemo(() => {
    const labels = new Set<string>();
    if (!currentBrief?.content_structured?.paragraphs) return labels;
    forEachCitation(currentBrief.content_structured.paragraphs, (c) => {
      if (c.type === 'law') labels.add(c.label);
    });
    return labels;
  }, [currentBrief]);

  const { citedLawRefs, availableLawRefs } = useMemo(() => {
    const cited: typeof lawRefs = [];
    const available: typeof lawRefs = [];
    for (const ref of lawRefs) {
      const label = `${ref.law_name} ${ref.article}`;
      if (citedLabels.has(label)) {
        cited.push(ref);
      } else if (ref.is_manual) {
        available.push(ref);
      }
    }
    return { citedLawRefs: cited, availableLawRefs: available };
  }, [lawRefs, citedLabels]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await api.post<{ results: SearchResult[] }>('/law/search', {
        query: q,
        limit: 10,
      });
      setResults(data.results);
      setSelected(new Set());
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(v), 300);
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
    } catch (err) {
      console.error('Add law refs failed:', err);
    }
    setAdding(false);
    setSelected(new Set());
    setQuery('');
    setResults([]);
    setSearchOpen(false);
  };

  const handleCloseSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setResults([]);
    setSelected(new Set());
  };

  const handleOpenSearch = () => {
    setSearchOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const selectableCount = results.filter(
    (r) => selected.has(r._id) && !existingIds.has(r._id),
  ).length;

  return (
    <div>
      <div className="px-3 py-2">
        {/* Inline search */}
        {searchOpen ? (
          <div className="mb-2 space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-t3" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleQueryChange}
                placeholder="法規名稱、條號或關鍵字"
                className="w-full rounded border border-bd bg-bg-2 py-1.5 pl-7 pr-7 text-xs text-t1 placeholder:text-t3 outline-none focus:border-ac"
              />
              <button
                onClick={handleCloseSearch}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-t3 hover:text-t1"
              >
                <X size={12} />
              </button>
            </div>
            {searching && <p className="text-[11px] text-t3">搜尋中...</p>}

            {/* Search results */}
            {results.length > 0 && (
              <div className="space-y-1">
                {results.map((r) => {
                  const alreadyAdded = existingIds.has(r._id);
                  const isSelected = selected.has(r._id);
                  return (
                    <button
                      key={r._id}
                      onClick={() => !alreadyAdded && handleToggle(r._id)}
                      disabled={alreadyAdded}
                      className={`w-full rounded border px-2.5 py-2 text-left transition ${
                        alreadyAdded
                          ? 'border-bd/50 opacity-50 cursor-default'
                          : isSelected
                            ? 'border-ac/40 bg-ac/5'
                            : 'border-bd hover:border-bd-l hover:bg-bg-2'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                            alreadyAdded
                              ? 'border-t3/30 bg-bg-3'
                              : isSelected
                                ? 'border-ac bg-ac'
                                : 'border-t3/50'
                          }`}
                        >
                          {(isSelected || alreadyAdded) && (
                            <Check
                              size={8}
                              strokeWidth={3}
                              color={alreadyAdded ? '#6c6f85' : 'white'}
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-medium text-t1">
                              {r.law_name} {r.article_no}
                            </span>
                            {alreadyAdded && <span className="text-[10px] text-t3">已加入</span>}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-t2">
                            {r.content}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Add button */}
                <button
                  onClick={handleAdd}
                  disabled={selectableCount === 0 || adding}
                  className="w-full rounded bg-ac py-1.5 text-xs font-medium text-white transition hover:bg-ac/80 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {adding
                    ? '加入中...'
                    : selectableCount > 0
                      ? `加入 ${selectableCount} 條法條`
                      : '選擇法條'}
                </button>
              </div>
            )}

            {results.length === 0 && query.trim() && !searching && (
              <p className="py-2 text-center text-[11px] text-t3">未找到相關法條</p>
            )}
          </div>
        ) : (
          <button
            onClick={handleOpenSearch}
            className="mb-2 flex w-full items-center gap-2 rounded border border-bd bg-bg-2 px-2.5 py-1.5 text-xs text-t3 transition hover:border-bd-l"
          >
            <Search size={12} />
            <span>搜尋法條</span>
          </button>
        )}

        {/* Existing law refs */}
        {citedLawRefs.length === 0 && availableLawRefs.length === 0 && !searchOpen ? (
          <div className="py-2 text-center">
            <p className="text-xs text-t3">尚無法條</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {citedLawRefs.length > 0 && (
              <>
                <p className="px-1 pt-1 text-xs font-medium text-t3">
                  已引用 ({citedLawRefs.length})
                </p>
                {citedLawRefs.map((ref) => (
                  <LawRefCard key={ref.id} lawRef={ref} cited onRemove={removeLawRef} />
                ))}
              </>
            )}
            {availableLawRefs.length > 0 && (
              <>
                <p className="px-1 pt-2 text-xs font-medium text-t3">
                  備用 ({availableLawRefs.length})
                </p>
                {availableLawRefs.map((ref) => (
                  <LawRefCard key={ref.id} lawRef={ref} onRemove={removeLawRef} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
