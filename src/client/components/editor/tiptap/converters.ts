import type { JSONContent } from '@tiptap/core';
import { nanoid } from 'nanoid';
import type { Paragraph, Citation, TextSegment } from '../../../stores/useBriefStore';

/**
 * Convert content_structured { paragraphs: Paragraph[] } → Tiptap JSONContent document.
 *
 * Mapping:
 *   section change   → heading level:2 (attrs: sectionName)
 *   subsection change → heading level:2 (attrs: subsectionName)
 *   paragraph         → one or more paragraph nodes (split at \n\n boundaries)
 *   single \n in text → hardBreak node (= Shift+Enter in Word)
 *   double \n\n       → separate <p> node (= Enter in Word, each gets text-indent)
 */
export function contentStructuredToTiptapDoc(
  content: { paragraphs: Paragraph[] } | null,
): JSONContent {
  if (!content || content.paragraphs.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }

  const nodes: JSONContent[] = [];
  let prevSection = '';
  let prevSubsection = '';
  let citationCounter = 0;

  for (const p of content.paragraphs) {
    // Section heading
    if (p.section && p.section !== prevSection) {
      nodes.push({
        type: 'heading',
        attrs: { level: 2, sectionName: p.section, subsectionName: null },
        content: [{ type: 'text', text: p.section }],
      });
      prevSection = p.section;
      prevSubsection = ''; // reset subsection on section change
    }

    // Subsection heading
    if (p.subsection && p.subsection !== prevSubsection) {
      nodes.push({
        type: 'heading',
        attrs: { level: 2, sectionName: null, subsectionName: p.subsection },
        content: [{ type: 'text', text: p.subsection }],
      });
      prevSubsection = p.subsection;
    }

    // Paragraph node(s) — split at \n\n boundaries into separate <p> nodes
    const pResult = buildParagraphNodes(p, citationCounter);
    citationCounter = pResult.nextCounter;
    nodes.push(...pResult.nodes);
  }

  return { type: 'doc', content: nodes };
}

/**
 * Normalize segments so that:
 * 1. No segment has empty text with citations (merge citations into the previous segment)
 * 2. Leading empty-text citations are pushed to after the first text segment
 *
 * This ensures citations always appear AFTER the text they reference.
 */
function normalizeSegments(segments: TextSegment[]): TextSegment[] {
  if (segments.length === 0) return segments;

  const result: TextSegment[] = [];
  let pendingCitations: Citation[] = [];

  for (const seg of segments) {
    if (!seg.text && seg.citations.length > 0) {
      // Empty text with citations — accumulate citations to attach to next segment with text
      pendingCitations.push(...seg.citations);
      continue;
    }

    if (seg.text) {
      if (pendingCitations.length > 0 && result.length > 0) {
        // Attach pending citations to the previous segment (they go after previous text)
        const prev = result[result.length - 1];
        result[result.length - 1] = {
          text: prev.text,
          citations: [...prev.citations, ...pendingCitations],
        };
        pendingCitations = [];
      }

      result.push({
        text: seg.text,
        citations: [...pendingCitations, ...seg.citations],
      });
      pendingCitations = [];
    }
  }

  // If there are still pending citations and no segments with text were found,
  // create a single segment
  if (pendingCitations.length > 0) {
    if (result.length > 0) {
      const last = result[result.length - 1];
      result[result.length - 1] = {
        text: last.text,
        citations: [...last.citations, ...pendingCitations],
      };
    } else {
      result.push({ text: '', citations: pendingCitations });
    }
  }

  return result;
}

function buildInlineContent(
  p: Paragraph,
  startCounter: number,
): { nodes: JSONContent[]; nextCounter: number } {
  const nodes: JSONContent[] = [];
  let counter = startCounter;

  if (p.segments && p.segments.length > 0) {
    const normalized = normalizeSegments(p.segments);
    for (const seg of normalized) {
      // Text with possible newlines → text nodes + hardBreak nodes
      pushTextWithBreaks(nodes, seg.text);

      // Inline citation nodes (always after text)
      for (const c of seg.citations) {
        nodes.push(citationToNode(c, counter));
        counter++;
      }
    }
  } else {
    // Old format: content_md + paragraph-level citations at end
    pushTextWithBreaks(nodes, p.content_md);
    for (const c of p.citations) {
      nodes.push(citationToNode(c, counter));
      counter++;
    }
  }

  return { nodes, nextCounter: counter };
}

function pushTextWithBreaks(nodes: JSONContent[], text: string) {
  if (!text) return;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      nodes.push({ type: 'hardBreak' });
    }
    if (lines[i]) {
      nodes.push({ type: 'text', text: lines[i] });
    }
  }
}

/**
 * Split inline nodes at consecutive hardBreak boundaries (\n\n).
 * Single hardBreaks (\n) are preserved as soft line breaks within a group.
 * Returns an array of node groups — each group becomes a separate <p>.
 */
const splitAtParagraphBoundaries = (nodes: JSONContent[]): JSONContent[][] => {
  const groups: JSONContent[][] = [[]];

  for (let i = 0; i < nodes.length; i++) {
    if (
      nodes[i].type === 'hardBreak' &&
      i + 1 < nodes.length &&
      nodes[i + 1].type === 'hardBreak'
    ) {
      // Consecutive hardBreaks → paragraph boundary
      groups.push([]);
      i++; // skip second hardBreak
      // Skip any additional consecutive hardBreaks (\n\n\n etc.)
      while (i + 1 < nodes.length && nodes[i + 1].type === 'hardBreak') {
        i++;
      }
    } else {
      groups[groups.length - 1].push(nodes[i]);
    }
  }

  // Trim leading/trailing hardBreaks from each group, then filter empty groups
  return groups
    .map((g) => {
      let start = 0;
      let end = g.length;
      while (start < end && g[start].type === 'hardBreak') start++;
      while (end > start && g[end - 1].type === 'hardBreak') end--;
      return g.slice(start, end);
    })
    .filter((g) => g.length > 0);
};

/**
 * Build one or more Tiptap paragraph nodes from a single Paragraph object.
 * If the inline content contains \n\n (consecutive hardBreaks), it is split
 * into separate <p> nodes so each gets its own CSS text-indent (like Word's Enter).
 */
const buildParagraphNodes = (
  p: Paragraph,
  startCounter: number,
): { nodes: JSONContent[]; nextCounter: number } => {
  const inlineContent = buildInlineContent(p, startCounter);

  // Fast path: no consecutive hardBreaks → single <p>
  const hasDoubleBreak = inlineContent.nodes.some(
    (n, i, arr) => n.type === 'hardBreak' && arr[i + 1]?.type === 'hardBreak',
  );

  if (!hasDoubleBreak) {
    return {
      nodes: [
        {
          type: 'paragraph',
          attrs: { paragraphId: p.id, disputeId: p.dispute_id },
          content: inlineContent.nodes.length > 0 ? inlineContent.nodes : undefined,
        },
      ],
      nextCounter: inlineContent.nextCounter,
    };
  }

  // Split into multiple <p> nodes
  const groups = splitAtParagraphBoundaries(inlineContent.nodes);

  if (groups.length === 0) {
    return {
      nodes: [
        {
          type: 'paragraph',
          attrs: { paragraphId: p.id, disputeId: p.dispute_id },
        },
      ],
      nextCounter: inlineContent.nextCounter,
    };
  }

  const paragraphNodes: JSONContent[] = groups.map((group, i) => ({
    type: 'paragraph',
    attrs: {
      paragraphId: i === 0 ? p.id : nanoid(),
      disputeId: p.dispute_id,
    },
    content: group,
  }));

  return { nodes: paragraphNodes, nextCounter: inlineContent.nextCounter };
};

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
      charStart: c.location?.char_start ?? null,
      charEnd: c.location?.char_end ?? null,
      blockIndex: c.location?.block_index ?? null,
      index,
    },
  };
}

/**
 * Convert Tiptap JSONContent document → content_structured { paragraphs: Paragraph[] }.
 *
 * Walks the document:
 *   heading with sectionName attr   → track current section
 *   heading with subsectionName attr → track current subsection
 *   paragraph node                   → build a Paragraph with segments from inline content
 */
export function tiptapDocToContentStructured(doc: JSONContent): {
  paragraphs: Paragraph[];
} {
  const paragraphs: Paragraph[] = [];
  let currentSection = '';
  let currentSubsection = '';

  if (!doc.content) return { paragraphs };

  for (const node of doc.content) {
    if (node.type === 'heading') {
      const text = extractText(node);
      if (node.attrs?.sectionName) {
        currentSection = node.attrs.sectionName;
        currentSubsection = '';
      } else if (node.attrs?.subsectionName) {
        currentSubsection = node.attrs.subsectionName;
      } else {
        // Heading without attrs: treat as section
        currentSection = text;
        currentSubsection = '';
      }
      continue;
    }

    if (node.type === 'paragraph') {
      const { segments, citations } = extractSegmentsFromNode(node);
      const contentMd = segments.map((s) => s.text).join('');

      paragraphs.push({
        id: node.attrs?.paragraphId || generateId(),
        section: currentSection,
        subsection: currentSubsection,
        content_md: contentMd,
        segments,
        dispute_id: node.attrs?.disputeId || null,
        citations,
      });
    }
  }

  return { paragraphs };
}

function extractText(node: JSONContent): string {
  if (!node.content) return '';
  return node.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('');
}

function extractSegmentsFromNode(node: JSONContent): {
  segments: TextSegment[];
  citations: Citation[];
} {
  const segments: TextSegment[] = [];
  const allCitations: Citation[] = [];
  let currentText = '';
  let currentCitations: Citation[] = [];

  function flush() {
    if (currentText || currentCitations.length > 0) {
      segments.push({ text: currentText, citations: [...currentCitations] });
      allCitations.push(...currentCitations);
      currentText = '';
      currentCitations = [];
    }
  }

  if (node.content) {
    for (const child of node.content) {
      if (child.type === 'text') {
        if (currentCitations.length > 0) flush();
        currentText += child.text || '';
      } else if (child.type === 'hardBreak') {
        currentText += '\n';
      } else if (child.type === 'citation') {
        const c = nodeToCitation(child);
        currentCitations.push(c);
      }
    }
  }

  flush();

  return { segments, citations: allCitations };
}

function nodeToCitation(node: JSONContent): Citation {
  const a = node.attrs || {};
  return {
    id: a.citationId || generateId(),
    label: a.label || '',
    type: a.type || 'law',
    file_id: a.fileId || undefined,
    location:
      a.blockIndex != null
        ? { block_index: a.blockIndex }
        : a.charStart != null && a.charEnd != null
          ? { char_start: a.charStart, char_end: a.charEnd }
          : undefined,
    quoted_text: a.quotedText || '',
    status: a.status || 'confirmed',
  };
}

const generateId = (): string => nanoid();
