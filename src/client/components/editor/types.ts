import type { Paragraph } from '../../stores/useBriefStore'

export interface BriefEditorProps {
  content: { paragraphs: Paragraph[] } | null
  onContentChange?: (structured: { paragraphs: Paragraph[] }) => void
  onCitationClick?: (citationId: string) => void
  highlightParagraphs?: string[]
}
