import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { briefs } from '../../db/schema';
import { callClaudeWithCitations, type ClaudeDocument, type ClaudeUsage } from '../claudeClient';
import { readLawRefs, removeLawRefsWhere } from '../../lib/lawRefsJson';
import { fetchAndCacheUncitedMentions } from '../../lib/lawRefService';
import { parseJsonField } from '../toolHelpers';
import { buildCaseMetaLines } from '../prompts/promptHelpers';
import type { StrategyOutput } from './types';
import type { PipelineContext } from '../briefPipeline';
import type { ContextStore } from '../contextStore';
import type { Paragraph, TextSegment, Citation } from '../../../client/stores/useBriefStore';

export const getSectionKey = (section: string, subsection?: string) =>
  `${section}${subsection ? ' > ' + subsection : ''}`;

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

// ── Step 5: Writer (v3 — uses ContextStore) ──

export type FileRow = {
  id: string;
  filename: string;
  full_text: string | null;
  content_md: string | null;
};

export const writeSectionV3 = async (
  ctx: PipelineContext,
  briefId: string,
  strategySection: StrategyOutput['sections'][number],
  writerCtx: ReturnType<ContextStore['getContextForSection']>,
  fileContentMap: Map<string, FileRow>,
  store: ContextStore,
  sectionIndex: number,
  usage: ClaudeUsage,
): Promise<Paragraph> => {
  const documents: ClaudeDocument[] = [];

  // ── Focus layer: relevant files ──
  for (const fileId of writerCtx.fileIds) {
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

  // Also add laws from sectionLawMap that aren't in strategy (backward compat)
  const strategyLawIds = new Set(writerCtx.laws.map((l) => l.id));
  const allFoundLaws = store.getAllFoundLaws();
  for (const law of allFoundLaws) {
    if (!strategyLawIds.has(law.id) && strategySection.relevant_law_ids.includes(law.id)) {
      documents.push({
        title: `${law.law_name} ${law.article_no}`,
        content: law.content,
        doc_type: 'law',
      });
    }
  }

  // ── Build Writer instruction with 3-layer context ──
  const dispute = strategySection.dispute_id
    ? store.legalIssues.find((d) => d.id === strategySection.dispute_id)
    : null;

  // Background layer: full outline with position marker
  const outlineText = writerCtx.fullOutline
    .map((o) => {
      const label = o.subsection ? `${o.section} > ${o.subsection}` : o.section;
      return o.isCurrent ? `  【你正在寫這段】${label}` : `  ${label}`;
    })
    .join('\n');

  // Focus layer: claims for this section (with attack/defense context)
  const typeLabels: Record<string, string> = {
    primary: '主要主張',
    rebuttal: '反駁',
    supporting: '輔助',
  };
  const claimsText =
    writerCtx.claims.length > 0
      ? writerCtx.claims
          .map((c) => {
            const sideLabel = c.side === 'ours' ? '我方' : '對方';
            const typeLabel = typeLabels[c.claim_type] || '主要主張';
            let line = `  ${c.id}: ${c.statement}（${sideLabel}｜${typeLabel}）`;
            if (c.responds_to) {
              const target = store.claims.find((t) => t.id === c.responds_to);
              if (target) line += `\n    → 回應：${target.id}「${target.statement.slice(0, 50)}」`;
            }
            return line;
          })
          .join('\n')
      : '（無特定主張）';

  // Focus layer: argumentation framework
  const argText = writerCtx.argumentation;
  const legalBasisText =
    argText.legal_basis.length > 0
      ? `法律依據：${argText.legal_basis.join('、')}`
      : '法律依據：（無）';

  // Focus layer: facts to use
  const factsText =
    writerCtx.factsToUse && writerCtx.factsToUse.length > 0
      ? writerCtx.factsToUse
          .map((f) => `  - ${f.fact_id}（${f.assertion_type}）：${f.usage}`)
          .join('\n')
      : '';

  // Review layer: completed sections full text
  const completedText =
    writerCtx.completedSections.length > 0
      ? writerCtx.completedSections
          .map((d) => {
            const sec = store.sections.find((s) => s.id === d.section_id);
            const label = sec ? getSectionKey(sec.section, sec.subsection) : d.section_id;
            return `【${label}】\n${d.content}`;
          })
          .join('\n\n')
      : '';

  const meta = store.caseMetadata;
  const caseMetaLines = buildCaseMetaLines(meta, '  ').join('\n');

  const instructionsLine = meta.caseInstructions
    ? `\n  律師處理指引：${meta.caseInstructions}`
    : '';

  let instruction = `你是台灣資深訴訟律師。請根據提供的論證結構和來源文件，撰寫法律書狀段落。

[書狀全局資訊]
  書狀類型：${writerCtx.briefType}${caseMetaLines ? '\n' + caseMetaLines : ''}${instructionsLine}
  完整大綱：
${outlineText}

[本段負責的 Claims]
${claimsText}

[本段論證結構]
  ${legalBasisText}
  事實適用：${argText.fact_application}
  結論：${argText.conclusion}`;

  if (factsText) {
    instruction += `

[事實運用]
${factsText}`;
  }

  if (dispute) {
    instruction += `

[爭點資訊]
  爭點：${dispute.title}
  我方立場：${dispute.our_position}
  對方立場：${dispute.their_position}`;
  }

  if (completedText) {
    instruction += `

[已完成段落]（維持前後文一致性）
${completedText}`;
  }

  instruction += `

[撰寫規則]
- 使用正式法律文書用語（繁體中文）
- 依照論證結構和 claims 列表撰寫，確保每個 claim 都有論述
- 引用法條時，務必從提供的法條文件中引用，讓系統能自動標記引用來源
- 引用事實時，從提供的來源文件中引用
- 對「承認」的事實，可使用「此為兩造所不爭執」等用語
- 對「爭執」的事實，需提出證據佐證
- 對「自認」的事實，使用「被告於答辯狀自承」等用語
- 對 rebuttal claim（反駁），需明確引用並反駁對方主張
- 對 supporting claim（輔助），需與同段落的主要主張呼應
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 直接撰寫段落內容，不需要加入章節標題
- 段落長度控制在 150-400 字之間`;

  // Call Claude Citations API
  const {
    text: rawText,
    segments: rawSegments,
    citations: rawCitations,
    usage: callUsage,
  } = await callClaudeWithCitations(ctx.aiEnv, documents, instruction);

  usage.input_tokens += callUsage.input_tokens;
  usage.output_tokens += callUsage.output_tokens;

  // Strip duplicate headings that Claude may have included
  const { text, segments, citations } = stripLeadingHeadings(
    rawText,
    rawSegments,
    rawCitations,
    strategySection.section,
    strategySection.subsection,
  );

  // Post-processing: detect uncited law mentions, fetch, cache, repair citations
  const citedLawLabels = new Set(citations.filter((c) => c.type === 'law').map((c) => c.label));
  const allRefs = await fetchAndCacheUncitedMentions(
    ctx.drizzle,
    ctx.caseId,
    ctx.mongoUrl,
    text,
    citedLawLabels,
  );

  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_law_refs',
    data: allRefs,
  });

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

  // Update brief in DB
  const briefRows = await ctx.drizzle.select().from(briefs).where(eq(briefs.id, briefId));
  const contentStructured = parseJsonField<{ paragraphs: Paragraph[] }>(
    briefRows[0]?.content_structured,
    { paragraphs: [] },
  );
  contentStructured.paragraphs.push(paragraph);

  await ctx.drizzle
    .update(briefs)
    .set({
      content_structured: JSON.stringify(contentStructured),
      updated_at: new Date().toISOString(),
    })
    .where(eq(briefs.id, briefId));

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
  // Collect all cited law labels from the written paragraphs
  const citedLabels = new Set<string>();
  for (const p of paragraphs) {
    for (const c of p.citations) {
      if (c.type === 'law') citedLabels.add(c.label);
    }
    if (p.segments) {
      for (const seg of p.segments) {
        for (const c of seg.citations) {
          if (c.type === 'law') citedLabels.add(c.label);
        }
      }
    }
  }

  // Remove non-manual law refs that aren't cited
  const beforeRefs = await readLawRefs(ctx.drizzle, ctx.caseId);
  const hasUncited = beforeRefs.some((ref) => {
    if (ref.is_manual) return false;
    const label = `${ref.law_name} ${ref.article}`;
    return !citedLabels.has(label);
  });

  if (hasUncited) {
    const remaining = await removeLawRefsWhere(ctx.drizzle, ctx.caseId, (ref) => {
      if (ref.is_manual) return false;
      const label = `${ref.law_name} ${ref.article}`;
      return !citedLabels.has(label);
    });

    await ctx.sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: 'set_law_refs',
      data: remaining,
    });
  }
};
