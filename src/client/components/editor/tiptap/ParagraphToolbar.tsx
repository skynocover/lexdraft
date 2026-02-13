import { useChatStore } from '../../../stores/useChatStore'

interface ParagraphToolbarProps {
  section: string
  subsection: string
  textPreview: string
  paragraphId: string
  onRequestDelete: (paragraphId: string) => void
}

function ToolbarButton({
  label,
  icon,
  onClick,
  variant = 'default',
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      className={`group/btn relative flex items-center gap-1 px-1.5 py-1 rounded text-xs ${
        variant === 'danger'
          ? 'text-t3 hover:text-rd hover:bg-bg-3'
          : 'text-t3 hover:text-ac hover:bg-bg-3'
      }`}
    >
      {icon}
      <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover/btn:max-w-[6rem] group-hover/btn:ml-0.5">
        {label}
      </span>
    </button>
  )
}

export function ParagraphToolbar({
  section,
  subsection,
  textPreview,
  paragraphId,
  onRequestDelete,
}: ParagraphToolbarProps) {
  const setPrefillInput = useChatStore((s) => s.setPrefillInput)

  const locationLabel = subsection
    ? `${section} > ${subsection}`
    : section

  return (
    <div className="absolute -top-1 right-2 z-20 flex items-center gap-0.5 rounded border border-bd bg-bg-2 shadow-lg opacity-0 group-hover/para:opacity-100 transition-opacity">
      <ToolbarButton
        label="AI 重寫"
        onClick={() =>
          setPrefillInput(
            `請重寫「${locationLabel}」段落：「${textPreview.slice(0, 50)}${textPreview.length > 50 ? '...' : ''}」`,
          )
        }
        icon={
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1z" fill="currentColor" />
            <path d="M3 11l.75 1.75L5.5 13.5l-1.75.75L3 16l-.75-1.75L.5 13.5l1.75-.75L3 11z" fill="currentColor" opacity="0.6" />
          </svg>
        }
      />

      <ToolbarButton
        label="加強論述"
        onClick={() =>
          setPrefillInput(`請加強「${locationLabel}」段落的論述力度`)
        }
        icon={
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 14V2M8 2l4 4M8 2L4 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
      />

      <ToolbarButton
        label="插入引用"
        onClick={() =>
          setPrefillInput(`請為「${locationLabel}」段落補充法條或文件引用`)
        }
        icon={
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4h8M4 8h8M4 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12 10l1.5 2L12 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
      />

      <ToolbarButton
        label="刪除"
        variant="danger"
        onClick={() => onRequestDelete(paragraphId)}
        icon={
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M3.5 4l.5 9a1 1 0 001 1h6a1 1 0 001-1l.5-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        }
      />
    </div>
  )
}
