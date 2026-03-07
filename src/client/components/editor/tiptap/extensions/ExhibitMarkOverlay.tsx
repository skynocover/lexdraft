import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
import { useTabStore } from '../../../../stores/useTabStore';
import { useCaseStore } from '../../../../stores/useCaseStore';
import { stripMarkdownHeaders } from '../../../../lib/textUtils';

const POPOVER_CLOSE_DELAY = 150;
const POPOVER_WIDTH = 320;

interface MarkData {
  citationId: string;
  fileId: string;
  label: string;
  quotedText: string;
  blockIndex: number | null;
}

interface ExhibitMarkOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const ExhibitMarkOverlay = ({ containerRef }: ExhibitMarkOverlayProps) => {
  const [markData, setMarkData] = useState<MarkData | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const activeMarkEl = useRef<HTMLElement | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      setMarkData(null);
      activeMarkEl.current = null;
      closeTimer.current = null;
    }, POPOVER_CLOSE_DELAY);
  }, [clearCloseTimer]);

  const handleMouseOver = useCallback(
    (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-exhibit-mark]') as HTMLElement | null;
      if (!target) return;

      clearCloseTimer();
      activeMarkEl.current = target;

      const bi = target.getAttribute('data-block-index');

      setMarkData({
        citationId: target.getAttribute('data-exhibit-mark') || '',
        fileId: target.getAttribute('data-file-id') || '',
        label: target.getAttribute('data-label') || target.textContent || '',
        quotedText: target.getAttribute('data-quoted-text') || '',
        blockIndex: bi ? parseInt(bi, 10) : null,
      });
    },
    [clearCloseTimer],
  );

  const handleMouseOut = useCallback(
    (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related && popoverRef.current?.contains(related)) return;
      if (related?.closest('[data-exhibit-mark]')) return;
      scheduleClose();
    },
    [scheduleClose],
  );

  // Position popover after mount/update (same pattern as CitationNodeView)
  useEffect(() => {
    if (!markData || !activeMarkEl.current) return;

    const updatePosition = () => {
      const mark = activeMarkEl.current;
      if (!mark) return;
      const rect = mark.getBoundingClientRect();
      const popoverHeight = popoverRef.current?.offsetHeight ?? 200;
      const margin = 8;

      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove = spaceAbove >= popoverHeight + margin || spaceAbove > spaceBelow;
      const top = placeAbove ? rect.top - popoverHeight - margin : rect.bottom + margin;

      let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8));

      setPopoverStyle({
        position: 'fixed',
        top,
        left,
        width: POPOVER_WIDTH,
        zIndex: 9999,
      });
    };

    updatePosition();
    requestAnimationFrame(updatePosition);
  }, [markData]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);
    return () => {
      container.removeEventListener('mouseover', handleMouseOver);
      container.removeEventListener('mouseout', handleMouseOut);
    };
  }, [containerRef, handleMouseOver, handleMouseOut]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  if (!markData) return null;

  const rangeLabel = markData.blockIndex != null ? `段落 ${markData.blockIndex + 1}` : null;

  const handleOpenFile = () => {
    if (!markData.fileId) return;
    const files = useCaseStore.getState().files;
    const file = files.find((f) => f.id === markData.fileId);
    if (!file || file.status !== 'ready') return;

    const text = markData.quotedText ? stripMarkdownHeaders(markData.quotedText).trim() : null;
    useTabStore.getState().openFileTabInOtherPanel(markData.fileId, file.filename, text);
    setMarkData(null);
  };

  return createPortal(
    <div
      ref={popoverRef}
      className="citation-popover"
      style={popoverStyle}
      onMouseEnter={clearCloseTimer}
      onMouseLeave={scheduleClose}
    >
      <div
        style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
      >
        <span
          style={{
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 600,
            background: 'rgba(59,130,246,0.15)',
            color: '#1d4ed8',
          }}
        >
          證物
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{markData.label}</span>
        {rangeLabel && <span style={{ fontSize: 9, color: '#9ca3af' }}>{rangeLabel}</span>}
      </div>

      {markData.quotedText && (
        <div
          style={{
            background: '#f9fafb',
            borderRadius: 4,
            padding: 8,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          <p
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 11,
              lineHeight: '18px',
              color: '#374151',
              borderLeft: '2px solid #93c5fd',
              paddingLeft: 8,
              margin: 0,
              textIndent: 0,
            }}
          >
            {stripMarkdownHeaders(markData.quotedText)}
          </p>
        </div>
      )}

      {markData.fileId && (
        <button
          onClick={handleOpenFile}
          className="citation-popover-btn citation-popover-btn--file"
        >
          <ExternalLink size={12} />
          開啟來源文件
        </button>
      )}
    </div>,
    document.body,
  );
};
