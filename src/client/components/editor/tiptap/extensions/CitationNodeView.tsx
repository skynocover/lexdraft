import { useRef, useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ExternalLink } from 'lucide-react';
import { useBriefStore } from '../../../../stores/useBriefStore';
import { useTabStore } from '../../../../stores/useTabStore';
import { useCaseStore } from '../../../../stores/useCaseStore';

const POPOVER_CLOSE_DELAY = 150;

/** Strip markdown headers (## ###) from cited text for display */
const stripMarkdownHeaders = (text: string): string => text.replace(/^#{1,3}\s+/gm, '');

export function CitationNodeView({ node }: NodeViewProps) {
  const [showPopover, setShowPopover] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const highlightCitationId = useBriefStore((s) => s.highlightCitationId);

  const handleMouseEnter = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setShowPopover(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => {
      setShowPopover(false);
      closeTimer.current = null;
    }, POPOVER_CLOSE_DELAY);
  }, []);

  // Position the popover relative to the badge using fixed positioning
  useEffect(() => {
    if (!showPopover || !badgeRef.current) return;

    const updatePosition = () => {
      const badge = badgeRef.current;
      if (!badge) return;
      const rect = badge.getBoundingClientRect();
      const popoverWidth = 320;
      const popoverHeight = popoverRef.current?.offsetHeight ?? 300;
      const margin = 8;

      // Prefer above; fall back to below if not enough space
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove = spaceAbove >= popoverHeight + margin || spaceAbove > spaceBelow;

      let top: number;
      if (placeAbove) {
        top = rect.top - popoverHeight - margin;
      } else {
        top = rect.bottom + margin;
      }

      // Horizontal: center on badge, clamp to viewport
      let left = rect.left + rect.width / 2 - popoverWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));

      setPopoverStyle({
        position: 'fixed',
        top,
        left,
        width: popoverWidth,
        zIndex: 9999,
      });
    };

    // Run immediately + after a frame (so popoverRef.current has height)
    updatePosition();
    requestAnimationFrame(updatePosition);
  }, [showPopover]);

  const {
    citationId,
    label,
    type,
    status,
    quotedText,
    fileId,
    index,
    blockIndex,
    charStart,
    charEnd,
  } = node.attrs;
  const isLaw = type === 'law';
  const isFile = type === 'file';
  const isPending = status === 'pending';
  const isHighlighted = citationId === highlightCitationId;

  const typeClass = isPending ? 'citation-pending' : isLaw ? 'citation-law' : 'citation-file';

  const highlightClass = isHighlighted ? ' animate-pulse ring-2 ring-yellow-500' : '';

  // 來源位置標示
  const rangeLabel =
    blockIndex != null
      ? `段落 ${blockIndex + 1}`
      : charStart != null && charEnd != null && charEnd - charStart > 0
        ? `第 ${charStart + 1}–${charEnd + 1} 字`
        : null;

  const handleOpenFile = useCallback(() => {
    if (!isFile || !fileId) return;
    const files = useCaseStore.getState().files;
    const file = files.find((f) => f.id === fileId);
    if (!file || file.status !== 'ready') return;

    const text = quotedText ? stripMarkdownHeaders(quotedText).trim() : null;
    useTabStore.getState().openFileTabInOtherPanel(fileId, file.filename, text);
    setShowPopover(false);
  }, [isFile, fileId, quotedText]);

  const handleOpenLaw = useCallback(() => {
    if (!isLaw || !label) return;
    const lawRefs = useBriefStore.getState().lawRefs;
    const lawRef = lawRefs.find(
      (r) => `${r.law_name} ${r.article}` === label || r.law_name === label,
    );
    if (!lawRef) return;

    useTabStore
      .getState()
      .openLawTabInOtherPanel(
        lawRef.id,
        lawRef.law_name ?? '',
        lawRef.article ?? '',
        lawRef.full_text ?? null,
      );
    setShowPopover(false);
  }, [isLaw, label]);

  return (
    <NodeViewWrapper
      as="span"
      className={`citation-badge ${typeClass}${highlightClass}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={badgeRef}
    >
      {index != null ? index + 1 : label}
      {showPopover &&
        createPortal(
          <div
            ref={popoverRef}
            className="citation-popover"
            style={popoverStyle}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Header: type badge + label + range + status */}
            <div
              style={{
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 600,
                  background: isLaw ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.15)',
                  color: isLaw ? '#6d28d9' : '#1d4ed8',
                }}
              >
                {isLaw ? '法條' : '文件'}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{label}</span>
              {rangeLabel && <span style={{ fontSize: 9, color: '#9ca3af' }}>{rangeLabel}</span>}
              {isPending && (
                <span
                  style={{
                    padding: '1px 4px',
                    borderRadius: 3,
                    fontSize: 9,
                    background: 'rgba(234,179,8,0.15)',
                    color: '#a16207',
                  }}
                >
                  待確認
                </span>
              )}
            </div>

            {/* Quoted text */}
            {quotedText && (
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
                  {stripMarkdownHeaders(quotedText)}
                </p>
              </div>
            )}

            {/* Open file button for file citations */}
            {isFile && fileId && (
              <button
                onClick={handleOpenFile}
                className="citation-popover-btn citation-popover-btn--file"
              >
                <ExternalLink size={12} />
                開啟來源文件
              </button>
            )}

            {/* Open law button for law citations */}
            {isLaw && (
              <button
                onClick={handleOpenLaw}
                className="citation-popover-btn citation-popover-btn--law"
              >
                <ExternalLink size={12} />
                開啟法條
              </button>
            )}
          </div>,
          document.body,
        )}
    </NodeViewWrapper>
  );
}
