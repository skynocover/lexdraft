import { useState, useEffect, useMemo } from 'react';
import { useBriefStore, type Citation } from '../../../stores/useBriefStore';

interface CitationReviewModalProps {
  open: boolean;
  onClose: () => void;
}

interface ReviewItem {
  paragraphId: string;
  citation: Citation;
  paragraphPreview: string;
}

export function CitationReviewModal({ open, onClose }: CitationReviewModalProps) {
  const currentBrief = useBriefStore((s) => s.currentBrief);
  const updateCitationStatus = useBriefStore((s) => s.updateCitationStatus);
  const removeCitation = useBriefStore((s) => s.removeCitation);
  const setHighlightCitationId = useBriefStore((s) => s.setHighlightCitationId);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [removedCount, setRemovedCount] = useState(0);
  const [finished, setFinished] = useState(false);

  // Collect all pending citations
  const pendingItems = useMemo<ReviewItem[]>(() => {
    if (!currentBrief?.content_structured) return [];
    const items: ReviewItem[] = [];
    for (const p of currentBrief.content_structured.paragraphs) {
      const preview = p.content_md.slice(0, 80);
      for (const c of p.citations) {
        if (c.status === 'pending') {
          items.push({
            paragraphId: p.id,
            citation: c,
            paragraphPreview: preview,
          });
        }
      }
      if (p.segments) {
        for (const seg of p.segments) {
          for (const c of seg.citations) {
            if (c.status === 'pending') {
              items.push({
                paragraphId: p.id,
                citation: c,
                paragraphPreview: preview,
              });
            }
          }
        }
      }
    }
    return items;
  }, [open]); // Only recompute when modal opens

  const total = pendingItems.length;
  const current = pendingItems[currentIndex];

  // Highlight current citation and scroll to paragraph
  useEffect(() => {
    if (!open || !current) return;
    setHighlightCitationId(current.citation.id);
    const el = document.querySelector(`[data-paragraph-id="${current.paragraphId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentIndex, open, current]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setCurrentIndex(0);
      setConfirmedCount(0);
      setRemovedCount(0);
      setFinished(false);
    }
  }, [open]);

  const goNext = () => {
    if (currentIndex + 1 >= total) {
      setFinished(true);
      setHighlightCitationId(null);
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleConfirm = () => {
    if (!current) return;
    updateCitationStatus(current.paragraphId, current.citation.id, 'confirmed');
    setConfirmedCount((n) => n + 1);
    goNext();
  };

  const handleRemove = () => {
    if (!current) return;
    removeCitation(current.paragraphId, current.citation.id);
    setRemovedCount((n) => n + 1);
    goNext();
  };

  const handleSkip = () => {
    goNext();
  };

  const handleClose = () => {
    setHighlightCitationId(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-[600px] rounded-lg border border-bd bg-bg-1 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bd px-5 py-3">
          <span className="text-sm font-medium text-t1">
            引用審查{' '}
            {!finished && total > 0 && (
              <span className="text-t3">
                ({currentIndex + 1}/{total})
              </span>
            )}
          </span>
          <button onClick={handleClose} className="text-t3 hover:text-t1 text-lg leading-none">
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {total === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-t2">沒有待確認的引用</p>
            </div>
          ) : finished ? (
            <div className="py-8 text-center">
              <p className="mb-2 text-sm font-medium text-t1">審查完成！</p>
              <p className="text-sm text-t2">
                <span className="text-gr">{confirmedCount} 確認</span>
                {' / '}
                <span className="text-rd">{removedCount} 移除</span>
                {total - confirmedCount - removedCount > 0 && (
                  <>
                    {' / '}
                    <span className="text-t3">{total - confirmedCount - removedCount} 跳過</span>
                  </>
                )}
              </p>
              <button
                onClick={handleClose}
                className="mt-4 rounded bg-ac px-4 py-1.5 text-sm font-medium text-bg-0 hover:bg-ac/80"
              >
                關閉
              </button>
            </div>
          ) : current ? (
            <>
              {/* Citation info */}
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    current.citation.type === 'law' ? 'bg-pu/20 text-pu' : 'bg-ac/20 text-ac'
                  }`}
                >
                  {current.citation.type === 'law' ? '法條' : '文件'}
                </span>
                <span className="truncate text-sm font-medium text-t1">
                  {current.citation.label}
                </span>
                <span className="shrink-0 rounded bg-yl/20 px-1.5 py-0.5 text-[11px] text-yl">
                  待確認
                </span>
              </div>

              {/* Source quote */}
              {current.citation.quoted_text && (
                <div className="mb-3">
                  <p className="mb-1 text-xs text-t3">來源原文</p>
                  <div className="rounded bg-bg-2 p-3">
                    <p className="whitespace-pre-wrap text-xs leading-5 text-t1 border-l-2 border-ac/40 pl-2.5">
                      {current.citation.quoted_text}
                    </p>
                  </div>
                </div>
              )}

              {/* Paragraph preview */}
              <div className="mb-4">
                <p className="mb-1 text-xs text-t3">書狀引用段落</p>
                <div className="rounded bg-bg-2 p-3">
                  <p className="text-xs leading-5 text-t2">
                    {current.paragraphPreview}
                    {current.paragraphPreview.length >= 80 && '...'}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleConfirm}
                  className="rounded bg-gr px-3 py-1.5 text-sm font-medium text-bg-0 hover:bg-gr/80"
                >
                  確認正確
                </button>
                <button
                  onClick={handleRemove}
                  className="rounded bg-rd px-3 py-1.5 text-sm font-medium text-bg-0 hover:bg-rd/80"
                >
                  移除引用
                </button>
                <button
                  onClick={handleSkip}
                  className="rounded border border-bd px-3 py-1.5 text-sm text-t2 hover:bg-bg-3"
                >
                  跳過
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
