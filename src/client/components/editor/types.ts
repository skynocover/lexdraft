import type { Citation, Paragraph } from '../../stores/useBriefStore'

export interface BriefEditorProps {
  content: { paragraphs: Paragraph[] } | null
  mode: 'preview' | 'edit'
  onContentChange: (structured: { paragraphs: Paragraph[] }) => void
  onCitationClick: (citationId: string) => void
  highlightParagraphs?: string[]
}
