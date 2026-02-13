import type { JSONContent } from '@tiptap/core'
import type { Paragraph, Citation, TextSegment } from '../../../stores/useBriefStore'

/**
 * Convert content_structured { paragraphs: Paragraph[] } → Tiptap JSONContent document.
 *
 * Mapping:
 *   section change   → heading level:2 (attrs: sectionName)
 *   subsection change → heading level:3 (attrs: subsectionName)
 *   paragraph         → paragraph node with inline text + citation atoms
 *   newlines in text  → hardBreak nodes
 */
export function contentStructuredToTiptapDoc(
  content: { paragraphs: Paragraph[] } | null,
): JSONContent {
  if (!content || content.paragraphs.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }

  const nodes: JSONContent[] = []
  let prevSection = ''
  let prevSubsection = ''
  let citationCounter = 0

  for (const p of content.paragraphs) {
    // Section heading
    if (p.section && p.section !== prevSection) {
      nodes.push({
        type: 'heading',
        attrs: { level: 2, sectionName: p.section, subsectionName: null },
        content: [{ type: 'text', text: p.section }],
      })
      prevSection = p.section
      prevSubsection = '' // reset subsection on section change
    }

    // Subsection heading
    if (p.subsection && p.subsection !== prevSubsection) {
      nodes.push({
        type: 'heading',
        attrs: { level: 3, sectionName: null, subsectionName: p.subsection },
        content: [{ type: 'text', text: p.subsection }],
      })
      prevSubsection = p.subsection
    }

    // Paragraph node
    const inlineContent = buildInlineContent(p, citationCounter)
    citationCounter = inlineContent.nextCounter

    nodes.push({
      type: 'paragraph',
      attrs: { paragraphId: p.id, disputeId: p.dispute_id },
      content: inlineContent.nodes.length > 0 ? inlineContent.nodes : undefined,
    })
  }

  return { type: 'doc', content: nodes }
}

/**
 * Normalize segments so that:
 * 1. No segment has empty text with citations (merge citations into the previous segment)
 * 2. Leading empty-text citations are pushed to after the first text segment
 *
 * This ensures citations always appear AFTER the text they reference.
 */
function normalizeSegments(segments: TextSegment[]): TextSegment[] {
  if (segments.length === 0) return segments

  const result: TextSegment[] = []
  let pendingCitations: Citation[] = []

  for (const seg of segments) {
    if (!seg.text && seg.citations.length > 0) {
      // Empty text with citations — accumulate citations to attach to next segment with text
      pendingCitations.push(...seg.citations)
      continue
    }

    if (seg.text) {
      if (pendingCitations.length > 0 && result.length > 0) {
        // Attach pending citations to the previous segment (they go after previous text)
        const prev = result[result.length - 1]
        result[result.length - 1] = {
          text: prev.text,
          citations: [...prev.citations, ...pendingCitations],
        }
        pendingCitations = []
      }

      result.push({
        text: seg.text,
        citations: [...pendingCitations, ...seg.citations],
      })
      pendingCitations = []
    }
  }

  // If there are still pending citations and no segments with text were found,
  // create a single segment
  if (pendingCitations.length > 0) {
    if (result.length > 0) {
      const last = result[result.length - 1]
      result[result.length - 1] = {
        text: last.text,
        citations: [...last.citations, ...pendingCitations],
      }
    } else {
      result.push({ text: '', citations: pendingCitations })
    }
  }

  return result
}

function buildInlineContent(
  p: Paragraph,
  startCounter: number,
): { nodes: JSONContent[]; nextCounter: number } {
  const nodes: JSONContent[] = []
  let counter = startCounter

  if (p.segments && p.segments.length > 0) {
    const normalized = normalizeSegments(p.segments)
    for (const seg of normalized) {
      // Text with possible newlines → text nodes + hardBreak nodes
      pushTextWithBreaks(nodes, seg.text)

      // Inline citation nodes (always after text)
      for (const c of seg.citations) {
        nodes.push(citationToNode(c, counter))
        counter++
      }
    }
  } else {
    // Old format: content_md + paragraph-level citations at end
    pushTextWithBreaks(nodes, p.content_md)
    for (const c of p.citations) {
      nodes.push(citationToNode(c, counter))
      counter++
    }
  }

  return { nodes, nextCounter: counter }
}

function pushTextWithBreaks(nodes: JSONContent[], text: string) {
  if (!text) return
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      nodes.push({ type: 'hardBreak' })
    }
    if (lines[i]) {
      nodes.push({ type: 'text', text: lines[i] })
    }
  }
}

function citationToNode(c: Citation, index: number): JSONContent {
  return {
    type: 'citation',
    attrs: {
      citationId: c.id,
      label: c.label,
      type: c.type,
      status: c.status,
      quotedText: c.quoted_text,
      fileId: c.file_id ?? null,
      index,
    },
  }
}

/**
 * Convert Tiptap JSONContent document → content_structured { paragraphs: Paragraph[] }.
 *
 * Walks the document:
 *   heading level:2 → track current section
 *   heading level:3 → track current subsection
 *   paragraph node  → build a Paragraph with segments from inline content
 */
export function tiptapDocToContentStructured(
  doc: JSONContent,
): { paragraphs: Paragraph[] } {
  const paragraphs: Paragraph[] = []
  let currentSection = ''
  let currentSubsection = ''

  if (!doc.content) return { paragraphs }

  for (const node of doc.content) {
    if (node.type === 'heading') {
      const level = node.attrs?.level
      const text = extractText(node)
      if (level === 2) {
        currentSection = node.attrs?.sectionName || text
        currentSubsection = ''
      } else if (level === 3) {
        currentSubsection = node.attrs?.subsectionName || text
      }
      continue
    }

    if (node.type === 'paragraph') {
      const { segments, citations } = extractSegmentsFromNode(node)
      const contentMd = segments.map((s) => s.text).join('')

      paragraphs.push({
        id: node.attrs?.paragraphId || generateId(),
        section: currentSection,
        subsection: currentSubsection,
        content_md: contentMd,
        segments,
        dispute_id: node.attrs?.disputeId || null,
        citations,
      })
    }
  }

  return { paragraphs }
}

function extractText(node: JSONContent): string {
  if (!node.content) return ''
  return node.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('')
}

function extractSegmentsFromNode(node: JSONContent): {
  segments: TextSegment[]
  citations: Citation[]
} {
  const segments: TextSegment[] = []
  const allCitations: Citation[] = []
  let currentText = ''
  let currentCitations: Citation[] = []

  function flush() {
    if (currentText || currentCitations.length > 0) {
      segments.push({ text: currentText, citations: [...currentCitations] })
      allCitations.push(...currentCitations)
      currentText = ''
      currentCitations = []
    }
  }

  if (node.content) {
    for (const child of node.content) {
      if (child.type === 'text') {
        if (currentCitations.length > 0) flush()
        currentText += child.text || ''
      } else if (child.type === 'hardBreak') {
        currentText += '\n'
      } else if (child.type === 'citation') {
        const c = nodeToCitation(child)
        currentCitations.push(c)
      }
    }
  }

  flush()

  return { segments, citations: allCitations }
}

function nodeToCitation(node: JSONContent): Citation {
  const a = node.attrs || {}
  return {
    id: a.citationId || generateId(),
    label: a.label || '',
    type: a.type || 'law',
    file_id: a.fileId || undefined,
    quoted_text: a.quotedText || '',
    status: a.status || 'confirmed',
  }
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}
