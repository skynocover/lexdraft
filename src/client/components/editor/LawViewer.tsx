import { useState, useEffect } from 'react';
import { Scale, ExternalLink, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import type { LawSearchResult } from '../../stores/useTabStore';

interface LawViewerProps {
  lawRefId: string;
  lawName: string;
  article: string;
  fullText: string | null;
}

/** Extract pcode from MongoDB _id format: "{pcode}-{條號}" */
const extractPcode = (lawRefId: string): string | null => {
  const dashIdx = lawRefId.indexOf('-');
  if (dashIdx <= 0) return null;
  return lawRefId.slice(0, dashIdx);
};

export const LawViewer = ({ lawRefId, lawName, article, fullText }: LawViewerProps) => {
  const [fetchedText, setFetchedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const displayText = fullText || fetchedText;

  // Auto-fetch when no fullText provided; reset when law identity changes
  useEffect(() => {
    if (fullText) {
      setFetchedText(null);
      return;
    }

    setFetchedText(null);
    let cancelled = false;
    const fetchLaw = async () => {
      setLoading(true);
      try {
        const data = await api.post<{ results: LawSearchResult[] }>('/law/search', {
          query: `${lawName}${article}`,
          limit: 5,
        });
        if (cancelled) return;
        const match = data.results.find((r) => r.law_name === lawName && r.article_no === article);
        if (match) {
          setFetchedText(match.content);
        }
      } catch {
        // Silent fail — just show "無法條內容"
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchLaw();
    return () => {
      cancelled = true;
    };
  }, [fullText, lawName, article]);

  // Derive pcode from lawRefId or fetched result
  const effectivePcode = extractPcode(lawRefId);
  const lawUrl = effectivePcode
    ? `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${effectivePcode}`
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-0">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-bd px-6 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pu/10">
          <Scale size={18} className="text-pu" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-t1">{lawName}</h2>
          <p className="text-sm text-t3">{article}</p>
        </div>
        {lawUrl && (
          <a
            href={lawUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-bd px-3 py-1.5 text-xs text-t2 transition hover:bg-bg-h hover:text-t1"
          >
            <ExternalLink size={12} />
            全國法規資料庫
          </a>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin text-t3" />
            <p className="text-sm text-t3">載入法條內容...</p>
          </div>
        ) : displayText ? (
          <div className="mx-auto max-w-160">
            <p className="whitespace-pre-wrap text-sm leading-7 text-t1">{displayText}</p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-t3">無法條內容</p>
          </div>
        )}
      </div>
    </div>
  );
};
