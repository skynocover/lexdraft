import { useState, useRef, useCallback } from "react";
import { api } from "../../../lib/api";
import { useBriefStore, type LawRef } from "../../../stores/useBriefStore";
import { useCaseStore } from "../../../stores/useCaseStore";

interface SearchResult {
  _id: string;
  law_name: string;
  article_no: string;
  content: string;
  pcode: string;
  nature: string;
  score: number;
}

interface LawSearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function LawSearchDialog({ open, onClose }: LawSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const lawRefs = useBriefStore((s) => s.lawRefs);
  const setLawRefs = useBriefStore((s) => s.setLawRefs);
  const currentCase = useCaseStore((s) => s.currentCase);

  const existingIds = new Set(lawRefs.map((r) => r.id));

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await api.post<{ results: SearchResult[] }>("/law/search", {
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
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAdd = async () => {
    if (!currentCase || selected.size === 0) return;
    setAdding(true);

    const toAdd = results.filter(
      (r) => selected.has(r._id) && !existingIds.has(r._id),
    );

    try {
      // POST to backend — stores in D1 with source='manual'
      const updatedRefs = await api.post<LawRef[]>(
        `/cases/${currentCase.id}/law-refs`,
        {
          items: toAdd.map((r) => ({
            id: r._id,
            law_name: r.law_name,
            article: r.article_no,
            full_text: r.content,
          })),
        },
      );
      setLawRefs(updatedRefs);
    } catch (err) {
      console.error("Add law refs failed:", err);
    }

    setAdding(false);
    setSelected(new Set());
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const selectableCount = results.filter(
    (r) => selected.has(r._id) && !existingIds.has(r._id),
  ).length;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-140 max-h-[80vh] flex flex-col rounded-lg border border-bd bg-bg-1 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bd px-4 py-3">
          <h3 className="text-sm font-medium text-t1">搜尋法條</h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-t3 transition hover:bg-bg-h hover:text-t1"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="border-b border-bd px-4 py-3">
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t3"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleQueryChange}
              placeholder="輸入法規名稱、條號或關鍵字，如「民法第184條」「損害賠償」"
              className="w-full rounded border border-bd bg-bg-2 py-2 pl-8 pr-3 text-xs text-t1 placeholder:text-t3 outline-none focus:border-ac"
              autoFocus
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-t3">
                搜尋中...
              </span>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {results.length === 0 && query.trim() && !searching ? (
            <p className="py-8 text-center text-xs text-t3">未找到相關法條</p>
          ) : results.length === 0 && !query.trim() ? (
            <p className="py-8 text-center text-xs text-t3">
              輸入關鍵字開始搜尋
            </p>
          ) : (
            <div className="space-y-1">
              {results.map((r) => {
                const alreadyAdded = existingIds.has(r._id);
                const isSelected = selected.has(r._id);

                return (
                  <button
                    key={r._id}
                    onClick={() => !alreadyAdded && handleToggle(r._id)}
                    disabled={alreadyAdded}
                    className={`w-full rounded-md border px-3 py-2.5 text-left transition ${
                      alreadyAdded
                        ? "border-bd/50 bg-bg-2/50 opacity-50 cursor-default"
                        : isSelected
                          ? "border-ac/40 bg-ac/5"
                          : "border-bd bg-bg-2 hover:border-bd-l hover:bg-bg-3"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Checkbox */}
                      <div
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          alreadyAdded
                            ? "border-t3/30 bg-bg-3"
                            : isSelected
                              ? "border-ac bg-ac"
                              : "border-t3/50"
                        }`}
                      >
                        {(isSelected || alreadyAdded) && (
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={alreadyAdded ? "#6c6f85" : "white"}
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded bg-pu/15 px-1.5 py-0.5 text-[9px] font-medium text-pu">
                            法規
                          </span>
                          <span className="text-xs font-medium text-t1">
                            {r.law_name} {r.article_no}
                          </span>
                          {alreadyAdded && (
                            <span className="text-[9px] text-t3">已加入</span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] leading-4 text-t2">
                          {r.content}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="flex items-center justify-between border-t border-bd px-4 py-3">
            <span className="text-[11px] text-t3">
              找到 {results.length} 條結果
            </span>
            <button
              onClick={handleAdd}
              disabled={selectableCount === 0 || adding}
              className="rounded-md bg-ac px-4 py-1.5 text-xs font-medium text-white transition hover:bg-ac/80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {adding
                ? "加入中..."
                : selectableCount > 0
                  ? `加入 ${selectableCount} 條法條`
                  : "選擇法條"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
