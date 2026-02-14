import { useRef, useCallback, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useBriefStore } from "../../../../stores/useBriefStore";

const POPOVER_CLOSE_DELAY = 150;

/** Strip markdown headers (## ###) from cited text for display */
const stripMarkdownHeaders = (text: string): string =>
  text.replace(/^#{1,3}\s+/gm, "");

export function CitationNodeView({ node }: NodeViewProps) {
  const [showPopover, setShowPopover] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const {
    citationId,
    label,
    type,
    status,
    quotedText,
    index,
    blockIndex,
    charStart,
    charEnd,
  } = node.attrs;
  const isLaw = type === "law";
  const isPending = status === "pending";
  const isHighlighted = citationId === highlightCitationId;

  const typeClass = isPending
    ? "citation-pending"
    : isLaw
      ? "citation-law"
      : "citation-file";

  const highlightClass = isHighlighted
    ? " animate-pulse ring-2 ring-yellow-500"
    : "";

  // 來源位置標示
  const rangeLabel =
    blockIndex != null
      ? `段落 ${blockIndex + 1}`
      : charStart != null && charEnd != null && charEnd - charStart > 0
        ? `第 ${charStart + 1}–${charEnd + 1} 字`
        : null;

  return (
    <NodeViewWrapper
      as="span"
      className={`citation-badge ${typeClass}${highlightClass}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {index != null ? index + 1 : label}
      {showPopover && (
        <div
          className="citation-popover"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Header: type badge + label + range + status */}
          <div
            style={{
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                padding: "1px 6px",
                borderRadius: 3,
                fontSize: 10,
                fontWeight: 600,
                background: isLaw
                  ? "rgba(139,92,246,0.15)"
                  : "rgba(59,130,246,0.15)",
                color: isLaw ? "#6d28d9" : "#1d4ed8",
              }}
            >
              {isLaw ? "法條" : "文件"}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>
              {label}
            </span>
            {rangeLabel && (
              <span style={{ fontSize: 9, color: "#9ca3af" }}>
                {rangeLabel}
              </span>
            )}
            {isPending && (
              <span
                style={{
                  padding: "1px 4px",
                  borderRadius: 3,
                  fontSize: 9,
                  background: "rgba(234,179,8,0.15)",
                  color: "#a16207",
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
                background: "#f9fafb",
                borderRadius: 4,
                padding: 8,
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              <p
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 11,
                  lineHeight: "18px",
                  color: "#374151",
                  borderLeft: "2px solid #93c5fd",
                  paddingLeft: 8,
                  margin: 0,
                  textIndent: 0,
                }}
              >
                {stripMarkdownHeaders(quotedText)}
              </p>
            </div>
          )}
          <div className="citation-popover-arrow" />
        </div>
      )}
    </NodeViewWrapper>
  );
}
