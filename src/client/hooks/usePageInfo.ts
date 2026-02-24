import { useState, useEffect, useCallback, type RefObject } from 'react';

const MARGIN_PX = 94.5; // 2.5cm
const PAGE_HEIGHT_PX = 933.5; // 24.7cm content per page

export interface PageInfo {
  currentPage: number;
  totalPages: number;
}

export const usePageInfo = (
  scrollContainerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): PageInfo => {
  const [pageInfo, setPageInfo] = useState<PageInfo>({ currentPage: 1, totalPages: 1 });

  const recalculate = useCallback(() => {
    const content = contentRef.current;
    const container = scrollContainerRef.current;
    if (!content || !container) return;

    // Total pages
    const contentArea = Math.max(0, content.scrollHeight - 2 * MARGIN_PX);
    const total = Math.max(1, Math.ceil(contentArea / PAGE_HEIGHT_PX));

    // Current page — snap to last page when scrolled to bottom
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
    let current: number;
    if (atBottom) {
      current = total;
    } else {
      const viewportCenter = container.scrollTop + container.clientHeight / 2;
      const contentY = Math.max(0, viewportCenter - MARGIN_PX);
      current = Math.max(1, Math.min(Math.floor(contentY / PAGE_HEIGHT_PX) + 1, total));
    }

    setPageInfo((prev) => {
      if (prev.currentPage === current && prev.totalPages === total) return prev;
      return { currentPage: current, totalPages: total };
    });
  }, []);

  // Scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !enabled) return;

    container.addEventListener('scroll', recalculate, { passive: true });
    return () => container.removeEventListener('scroll', recalculate);
  }, [recalculate, enabled]);

  // ResizeObserver on content
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !enabled) return;

    const observer = new ResizeObserver(() => recalculate());
    observer.observe(content);
    recalculate();
    return () => observer.disconnect();
  }, [recalculate, enabled]);

  return pageInfo;
};
