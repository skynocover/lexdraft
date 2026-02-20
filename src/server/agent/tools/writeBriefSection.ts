import { eq, sql, and, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs, lawRefs } from '../../db/schema';
import { callClaudeWithCitations, type ClaudeDocument } from '../claudeClient';
import { parseJsonField } from '../toolHelpers';
import { searchLaw } from '../../lib/lawSearch';
import { hasReplacementChars, buildLawTextMap, repairLawCitations } from '../../lib/textSanitize';
import type { Paragraph } from '../../../client/stores/useBriefStore';
import type { ToolHandler } from './types';

/** Regex to detect law article references like 民法第184條、道路交通安全規則第102條第1項第7款 */
const LAW_ARTICLE_REGEX = /([\u4e00-\u9fff]{2,}(?:法|規則|條例|辦法|細則))第(\d+條(?:之\d+)?)/g;

export const handleWriteBriefSection: ToolHandler = async (args, caseId, _db, drizzle, ctx) => {
  if (!ctx) {
    return { result: 'Error: missing execution context', success: false };
  }

  const briefId = args.brief_id as string;
  const paragraphId = (args.paragraph_id as string) || null;
  const section = args.section as string;
  const subsection = (args.subsection as string) || '';
  const instruction = args.instruction as string;
  const relevantFileIds = args.relevant_file_ids as string[];
  const relevantLawIds = (args.relevant_law_ids as string[]) || [];
  const disputeId = (args.dispute_id as string) || null;

  if (!briefId || !section || !instruction || !relevantFileIds?.length) {
    return {
      result: 'Error: brief_id, section, instruction, relevant_file_ids are required',
      success: false,
    };
  }

  // 1. Read brief and determine if this is an update or create (must happen before Claude call)
  const briefRows = await drizzle.select().from(briefs).where(eq(briefs.id, briefId));

  if (!briefRows.length) {
    return {
      result: `Error: brief not found (id: ${briefId})`,
      success: false,
    };
  }

  const brief = briefRows[0];
  const contentStructured = parseJsonField<{ paragraphs: Paragraph[] }>(brief.content_structured, {
    paragraphs: [],
  });

  // Determine if this is an update: explicit paragraph_id or matching section/subsection
  let matchedId = paragraphId;
  if (!matchedId) {
    const existing = contentStructured.paragraphs.find(
      (p) => p.section === section && p.subsection === subsection,
    );
    if (existing) matchedId = existing.id;
  }

  const isUpdate = !!matchedId && contentStructured.paragraphs.some((p) => p.id === matchedId);
  const existingParagraph = isUpdate
    ? contentStructured.paragraphs.find((p) => p.id === matchedId)
    : null;

  // 2. Load file contents for document blocks (prefer content_md for citation chunking)
  const fileRows = await drizzle
    .select({
      id: files.id,
      filename: files.filename,
      full_text: files.full_text,
      content_md: files.content_md,
    })
    .from(files)
    .where(eq(files.case_id, caseId));

  const relevantFiles = fileRows.filter((f) => relevantFileIds.includes(f.id));
  if (!relevantFiles.length) {
    return { result: 'Error: no matching files found', success: false };
  }

  const documents: ClaudeDocument[] = relevantFiles.map((f) => ({
    title: f.filename,
    content: (f.content_md || f.full_text || '').slice(0, 20000),
    file_id: f.id,
    doc_type: 'file' as const,
  }));

  // 3. Load law refs specified by relevant_law_ids: D1 cache first, fallback to MongoDB
  const loadedLawIds = new Set<string>();
  if (relevantLawIds.length) {
    const uncachedIds = relevantLawIds.filter((id) => !loadedLawIds.has(id));

    if (uncachedIds.length) {
      // Check D1 cache
      const cachedRows = await drizzle
        .select()
        .from(lawRefs)
        .where(and(eq(lawRefs.case_id, caseId), inArray(lawRefs.id, uncachedIds)));

      for (const ref of cachedRows) {
        if (ref.full_text) {
          documents.push({
            title: `${ref.law_name} ${ref.article}`,
            content: ref.full_text,
            doc_type: 'law' as const,
          });
          loadedLawIds.add(ref.id);
        }
      }

      // Fetch missing from MongoDB and cache in D1
      const stillMissing = uncachedIds.filter((id) => !loadedLawIds.has(id));
      if (stillMissing.length && ctx.mongoUrl) {
        for (const lawId of stillMissing) {
          try {
            const results = await searchLaw(ctx.mongoUrl, {
              query: lawId,
              limit: 1,
            });
            if (results.length > 0) {
              const r = results[0];
              // Skip if MongoDB returned corrupted text
              if (hasReplacementChars(r.content)) {
                console.warn(`Skipping corrupted law text from MongoDB: ${r._id}`);
                continue;
              }
              await drizzle
                .insert(lawRefs)
                .values({
                  id: r._id,
                  case_id: caseId,
                  law_name: r.law_name,
                  article: r.article_no,
                  title: `${r.law_name} ${r.article_no}`,
                  full_text: r.content,
                  usage_count: 1,
                  is_manual: false,
                })
                .onConflictDoUpdate({
                  target: lawRefs.id,
                  set: {
                    usage_count: sql`coalesce(${lawRefs.usage_count}, 0) + 1`,
                  },
                });
              documents.push({
                title: `${r.law_name} ${r.article_no}`,
                content: r.content,
                doc_type: 'law' as const,
              });
              loadedLawIds.add(r._id);
            }
          } catch {
            /* skip on error */
          }
        }
      }
    }
  }

  // 4. Build Claude instruction based on CREATE or UPDATE mode
  let claudeInstruction: string;

  if (isUpdate && existingParagraph) {
    claudeInstruction = `你是一位專業的台灣律師助理。以下是書狀中的既有段落，請在保留原有內容的前提下，根據指示進行修改。

既有段落內容：
---
${existingParagraph.content_md}
---

章節：${section}
子章節：${subsection || '（無）'}
修改指示：${instruction}

修改規則：
- 保留原有的核心論述和架構
- 在適當位置自然地融入新內容（如法條引用）
- 引用法條時，務必從提供的法條文件中引用，讓系統能自動標記引用來源
- 使用正式法律文書用語（繁體中文）
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 直接輸出修改後的段落內容，不需要加入章節標題
- 不要大幅改變原有段落的結構和語意`;
  } else {
    claudeInstruction = `你是一位專業的台灣律師助理。請根據提供的來源文件和法條，撰寫法律書狀的一個段落。

撰寫要求：
- 章節：${section}
- 子章節：${subsection || '（無）'}
- 指示：${instruction}

撰寫規則：
- 使用正式法律文書用語（繁體中文）
- 論述要有邏輯、條理分明
- 引用法條時，務必從提供的法條文件中引用，讓系統能自動標記引用來源
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 直接撰寫段落內容，不需要加入章節標題
- 段落長度控制在 150-300 字之間，簡潔有力`;
  }

  // 5. Call Claude Citations API
  const { text, segments, citations } = await callClaudeWithCitations(
    ctx.aiEnv,
    documents,
    claudeInstruction,
  );

  // 6. Post-processing: detect uncited law mentions in text and cache in D1
  const citedLawLabels = new Set(citations.filter((c) => c.type === 'law').map((c) => c.label));

  // Deduplicate: use Set to avoid redundant MongoDB queries for same law
  const mentionedLawKeys = new Set<string>();
  for (const match of text.matchAll(LAW_ARTICLE_REGEX)) {
    mentionedLawKeys.add(`${match[1]}|第${match[2]}`);
  }

  // Find laws mentioned in text but not cited by Claude — store in D1 as cache
  const uncitedLaws = Array.from(mentionedLawKeys)
    .map((key) => {
      const [lawName, article] = key.split('|');
      return { lawName, article };
    })
    .filter((m) => !citedLawLabels.has(`${m.lawName} ${m.article}`));

  if (uncitedLaws.length > 0 && ctx.mongoUrl) {
    for (const law of uncitedLaws) {
      try {
        const results = await searchLaw(ctx.mongoUrl, {
          query: `${law.lawName} ${law.article}`,
          limit: 1,
        });
        if (results.length > 0) {
          const r = results[0];
          if (hasReplacementChars(r.content)) {
            console.warn(`Skipping corrupted law text from MongoDB: ${r._id}`);
            continue;
          }
          await drizzle
            .insert(lawRefs)
            .values({
              id: r._id,
              case_id: caseId,
              law_name: r.law_name,
              article: r.article_no,
              title: `${r.law_name} ${r.article_no}`,
              full_text: r.content,
              usage_count: 1,
              is_manual: false,
            })
            .onConflictDoUpdate({
              target: lawRefs.id,
              set: {
                usage_count: sql`coalesce(${lawRefs.usage_count}, 0) + 1`,
              },
            });
        }
      } catch {
        /* skip on error */
      }
    }
  }

  // Send updated law refs to frontend
  const displayRefs = await drizzle.select().from(lawRefs).where(eq(lawRefs.case_id, caseId));

  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_law_refs',
    data: displayRefs,
  });

  // 6b. Repair corrupted quoted_text in law citations using D1 data
  const lawTextMap = buildLawTextMap(displayRefs);
  const allCitationRefs = [...citations, ...segments.flatMap((s) => s.citations)];
  repairLawCitations(allCitationRefs, lawTextMap);

  // 7. Build Paragraph object
  const lawCitationCount = citations.filter((c) => c.type === 'law').length;
  const fileCitationCount = citations.filter((c) => c.type === 'file').length;

  const paragraph: Paragraph = {
    id: isUpdate && matchedId ? matchedId : paragraphId || nanoid(),
    section,
    subsection,
    content_md: text,
    segments,
    dispute_id: disputeId,
    citations,
  };

  // 8. Update brief content (add or replace paragraph)
  if (isUpdate) {
    contentStructured.paragraphs = contentStructured.paragraphs.map((p) =>
      p.id === matchedId ? paragraph : p,
    );
  } else {
    contentStructured.paragraphs.push(paragraph);
  }

  // 9. Update DB
  await drizzle
    .update(briefs)
    .set({
      content_structured: JSON.stringify(contentStructured),
      updated_at: new Date().toISOString(),
    })
    .where(eq(briefs.id, briefId));

  // 10. Send SSE brief_update
  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: briefId,
    action: isUpdate ? 'update_paragraph' : 'add_paragraph',
    data: paragraph,
  });

  const actionLabel = isUpdate ? '已更新' : '已撰寫';
  return {
    result: `${actionLabel}段落「${section}${subsection ? ' > ' + subsection : ''}」，包含 ${fileCitationCount} 個文件引用、${lawCitationCount} 個法條引用。`,
    success: true,
  };
};
