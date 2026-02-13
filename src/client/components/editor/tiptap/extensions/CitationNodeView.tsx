import { useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useBriefStore } from '../../../../stores/useBriefStore'

export function CitationNodeView({ node }: NodeViewProps) {
  const [showPopover, setShowPopover] = useState(false)
  const highlightCitationId = useBriefStore((s) => s.highlightCitationId)

  const { citationId, label, type, status, quotedText, index } = node.attrs
  const isLaw = type === 'law'
  const isPending = status === 'pending'
  const isHighlighted = citationId === highlightCitationId

  const typeClass = isPending
    ? 'citation-pending'
    : isLaw
      ? 'citation-law'
      : 'citation-file'

  const highlightClass = isHighlighted ? ' animate-pulse ring-2 ring-yellow-500' : ''

  return (
    <NodeViewWrapper
      as="span"
      className={`citation-badge ${typeClass}${highlightClass}`}
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      {index != null ? index + 1 : label}
      {showPopover && (
        <div className="citation-popover">
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              padding: '1px 6px',
              borderRadius: 3,
              fontSize: 10,
              fontWeight: 600,
              background: isLaw ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.15)',
              color: isLaw ? '#6d28d9' : '#1d4ed8',
            }}>
              {isLaw ? '法條' : '文件'}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{label}</span>
            {isPending && (
              <span style={{
                padding: '1px 4px',
                borderRadius: 3,
                fontSize: 9,
                background: 'rgba(234,179,8,0.15)',
                color: '#a16207',
              }}>待確認</span>
            )}
          </div>
          {quotedText && (
            <div style={{
              maxHeight: 160,
              overflowY: 'auto',
              background: '#f9fafb',
              borderRadius: 4,
              padding: 8,
            }}>
              <p style={{
                whiteSpace: 'pre-wrap',
                fontSize: 11,
                lineHeight: '18px',
                color: '#374151',
                borderLeft: '2px solid #93c5fd',
                paddingLeft: 8,
                margin: 0,
                textIndent: 0,
              }}>
                {quotedText}
              </p>
            </div>
          )}
          <div className="citation-popover-arrow" />
        </div>
      )}
    </NodeViewWrapper>
  )
}
