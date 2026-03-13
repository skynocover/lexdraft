import { nanoid } from 'nanoid';
import { callClaudeWithCitations, type ClaudeDocument } from '../claudeClient';
import { callOpenRouterText } from '../aiClient';
import { readLawRefs, removeLawRefsWhere } from '../../lib/lawRefsJson';
import {
  getSectionKey,
  isContentSection,
  type StrategyOutput,
  type PipelineContext,
} from './types';
import { buildWriterInstruction } from './writerPrompt';
import type { ContextStore } from '../contextStore';
import type { Paragraph, TextSegment, Citation } from '../../../client/stores/useBriefStore';

export { getSectionKey };

/** Strip markdown formatting (headings, blockquotes, bold) from AI output */
const stripMarkdown = (t: string): string =>
  t
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1');

/**
 * Rebuild segments so their concatenated text matches `strippedText`.
 * Walks through original segments, applies stripMarkdown to each,
 * then slices from strippedText to keep offsets consistent.
 */
const rebuildSegmentsAfterStrip = (
  originalText: string,
  originalSegments: TextSegment[],
  strippedText: string,
): { text: string; segments: TextSegment[] } => {
  // Fast path: nothing changed
  if (originalText === strippedText) {
    return { text: strippedText, segments: originalSegments };
  }

  const segments: TextSegment[] = [];
  let offset = 0;

  for (const seg of originalSegments) {
    const segStripped = stripMarkdown(seg.text);
    const len = segStripped.length;
    // Slice from strippedText to guarantee the concat matches exactly
    const alignedText = strippedText.slice(offset, offset + len);
    segments.push({ ...seg, text: alignedText || segStripped });
    offset += len;
  }

  return { text: strippedText, segments };
};

// ── Heading deduplication helper ──

const stripLeadingHeadings = (
  text: string,
  segments: TextSegment[],
  citations: Citation[],
  section: string,
  subsection?: string,
): {
  text: string;
  segments: TextSegment[];
  citations: Citation[];
} => {
  // Build patterns to match: section/subsection headings possibly prefixed with # marks
  const headings = [section];
  if (subsection) headings.push(subsection);

  let stripped = text;
  let totalCharsRemoved = 0;

  // Strip leading lines that match headings
  for (const heading of headings) {
    // Match: optional leading whitespace, optional `#`+ prefix, optional whitespace, then heading text, then newline
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^\\s*#{0,6}\\s*${escaped}\\s*\\n?`);
    const match = stripped.match(pattern);
    if (match) {
      totalCharsRemoved += match[0].length;
      stripped = stripped.slice(match[0].length);
    }
  }

  // Also strip any remaining leading blank lines after heading removal
  const leadingBlanks = stripped.match(/^(\s*\n)+/);
  if (leadingBlanks) {
    totalCharsRemoved += leadingBlanks[0].length;
    stripped = stripped.slice(leadingBlanks[0].length);
  }

  if (totalCharsRemoved === 0) {
    return { text, segments, citations };
  }

  // Adjust segments: walk through and trim/drop by character count
  let charsToSkip = totalCharsRemoved;
  const newSegments: TextSegment[] = [];

  for (const seg of segments) {
    if (charsToSkip <= 0) {
      newSegments.push(seg);
      continue;
    }

    if (charsToSkip >= seg.text.length) {
      // Entire segment is in the stripped region — drop it
      charsToSkip -= seg.text.length;
      continue;
    }

    // Partial overlap — trim the beginning of this segment
    newSegments.push({
      text: seg.text.slice(charsToSkip),
      citations: seg.citations,
    });
    charsToSkip = 0;
  }

  // Collect remaining citation IDs from surviving segments
  const remainingCitationIds = new Set<string>();
  for (const seg of newSegments) {
    for (const c of seg.citations) {
      remainingCitationIds.add(c.id);
    }
  }

  const newCitations = citations.filter((c) => remainingCitationIds.has(c.id));

  return { text: stripped, segments: newSegments, citations: newCitations };
};

// ── Step 3: Writer (uses ContextStore) ──

export type FileRow = {
  id: string;
  filename: string;
  full_text: string | null;
  content_md: string | null;
};

export const writeSection = async (
  ctx: PipelineContext,
  briefId: string,
  strategySection: StrategyOutput['sections'][number],
  writerCtx: ReturnType<ContextStore['getContextForSection']>,
  fileContentMap: Map<string, FileRow>,
  store: ContextStore,
  exhibitMap?: Map<string, string>,
): Promise<Paragraph> => {
  const documents: ClaudeDocument[] = [];

  // ── Focus layer: relevant files (no fallback — intro/conclusion don't need all files) ──
  const effectiveFileIds = writerCtx.fileIds;

  for (const fileId of effectiveFileIds) {
    const file = fileContentMap.get(fileId);
    if (file) {
      const content = (file.content_md || file.full_text || '').slice(0, 20000);
      if (content) {
        documents.push({ title: file.filename, content, file_id: file.id, doc_type: 'file' });
      }
    }
  }

  // ── Focus layer: laws from strategy (only this section's relevant laws) ──
  for (const law of writerCtx.laws) {
    documents.push({
      title: `${law.law_name} ${law.article_no}`,
      content: law.content,
      doc_type: 'law',
    });
  }

  const sectionKey = getSectionKey(strategySection.section, strategySection.subsection);
  const lawCount = documents.filter((d) => d.doc_type === 'law').length;
  const fileCount = documents.length - lawCount;
  console.log(`[writer] section="${sectionKey}" laws=${lawCount} files=${fileCount}`);

  // ── Build Writer instruction (prompt assembly delegated to writerPrompt.ts) ──
  const instruction = buildWriterInstruction({
    templateId: ctx.templateId,
    strategySection,
    writerCtx,
    documents,
    store,
    exhibitMap,
  });

  let text: string;
  let segments: TextSegment[];
  let citations: Citation[];

  if (isContentSection(strategySection)) {
    // ── Content sections (有 subsection) → Claude Sonnet + Citations API ──
    const {
      text: rawText,
      segments: rawSegments,
      citations: rawCitations,
    } = await callClaudeWithCitations(ctx.aiEnv, documents, instruction);

    // Strip duplicate headings that Claude may have included
    const {
      text: headingStrippedText,
      segments: headingStrippedSegments,
      citations: strippedCitations,
    } = stripLeadingHeadings(
      rawText,
      rawSegments,
      rawCitations,
      strategySection.section,
      strategySection.subsection,
    );

    // Strip markdown from full text first, then rebuild segments to guarantee consistency.
    const strippedText = stripMarkdown(headingStrippedText);
    const rebuilt = rebuildSegmentsAfterStrip(
      headingStrippedText,
      headingStrippedSegments,
      strippedText,
    );
    text = rebuilt.text;
    segments = rebuilt.segments;
    citations = strippedCitations;
  } else {
    // ── Intro/conclusion (無 subsection) → Gemini Flash (no citations needed) ──
    // Role framing is already in `instruction` (buildWriterInstruction includes it)
    const result = await callOpenRouterText(ctx.aiEnv, '', instruction, {
      maxTokens: 2048,
      signal: ctx.signal,
    });
    text = stripMarkdown(result.content.trim());
    segments = [{ text, citations: [] }];
    citations = [];
  }

  // Build paragraph
  const paragraph: Paragraph = {
    id: nanoid(),
    section: strategySection.section,
    subsection: strategySection.subsection || '',
    content_md: text,
    segments,
    dispute_id: strategySection.dispute_id || null,
    citations,
  };

  // Stamp exhibit_label on file citations for reorder sync
  if (exhibitMap && exhibitMap.size > 0) {
    const stampExhibitLabel = (c: Citation) => {
      if (c.type === 'file' && c.file_id) {
        const label = exhibitMap.get(c.file_id);
        if (label) c.exhibit_label = label;
      }
    };
    for (const c of paragraph.citations) stampExhibitLabel(c);
    for (const seg of paragraph.segments ?? []) {
      for (const c of seg.citations) stampExhibitLabel(c);
    }
  }

  // Send paragraph SSE
  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: briefId,
    action: 'add_paragraph',
    data: paragraph,
  });

  return paragraph;
};

// ── Cleanup: remove uncited non-manual law refs after pipeline ──

export const cleanupUncitedLaws = async (ctx: PipelineContext, paragraphs: Paragraph[]) => {
  // Collect all cited law labels from Citations API markers (paragraphs + segments in one pass)
  const citedLabels = new Set<string>();
  for (const p of paragraphs) {
    for (const c of p.citations) {
      if (c.type === 'law') citedLabels.add(c.label);
    }
    for (const seg of p.segments ?? []) {
      for (const c of seg.citations) {
        if (c.type === 'law') citedLabels.add(c.label);
      }
    }
  }

  // Collect full text for text-mention detection
  const fullText = paragraphs.map((p) => p.content_md).join('\n');

  // Check if a law is mentioned in the brief text (e.g., "民法第191-2條"), with cache
  const textMentionCache = new Map<string, boolean>();
  const isMentionedInText = (lawName: string, article: string): boolean => {
    const key = `${lawName}|${article}`;
    if (textMentionCache.has(key)) return textMentionCache.get(key)!;
    const numMatch = article.match(/(\d[\d-]*)/);
    if (!numMatch) {
      textMentionCache.set(key, false);
      return false;
    }
    const num = numMatch[1];
    const pattern = new RegExp(`${lawName}[第§]\\s*${num.replace('-', '[-之]')}\\s*條?`);
    const result = pattern.test(fullText);
    textMentionCache.set(key, result);
    return result;
  };

  // Predicate: should this law ref be removed?
  const shouldRemove = (ref: {
    is_manual?: boolean;
    law_name: string;
    article: string;
  }): boolean => {
    if (ref.is_manual) return false;
    const label = `${ref.law_name} ${ref.article}`;
    if (citedLabels.has(label)) return false;
    if (isMentionedInText(ref.law_name, ref.article)) return false;
    return true;
  };

  // Remove non-manual law refs that aren't cited AND aren't mentioned in text
  const beforeRefs = await readLawRefs(ctx.drizzle, ctx.caseId);
  const hasUncited = beforeRefs.some(shouldRemove);

  const finalRefs = hasUncited
    ? await removeLawRefsWhere(ctx.drizzle, ctx.caseId, shouldRemove)
    : beforeRefs;

  // Always send final law refs to frontend (batch fetchAndCacheUncitedMentions may have added new refs)
  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_law_refs',
    data: finalRefs,
  });
};
