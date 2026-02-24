import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { files, briefs } from '../../db/schema';
import { callClaudeWithCitations, type ClaudeDocument } from '../claudeClient';
import { toolError, toolSuccess, parseJsonField } from '../toolHelpers';
import { loadLawDocsByIds, fetchAndCacheUncitedMentions } from '../../lib/lawRefService';
import type { Paragraph } from '../../../client/stores/useBriefStore';
import type { ToolHandler } from './types';

export const handleWriteBriefSection: ToolHandler = async (args, caseId, _db, drizzle, ctx) => {
  if (!ctx) {
    return toolError('缺少執行上下文');
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
    return toolError('brief_id、section、instruction、relevant_file_ids 為必填');
  }

  // 1. Read brief and determine if this is an update or create (must happen before Claude call)
  const briefRows = await drizzle.select().from(briefs).where(eq(briefs.id, briefId));

  if (!briefRows.length) {
    return toolError(`找不到書狀（id: ${briefId}）`);
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
  const relevantFiles = await drizzle
    .select({
      id: files.id,
      filename: files.filename,
      full_text: files.full_text,
      content_md: files.content_md,
    })
    .from(files)
    .where(inArray(files.id, relevantFileIds));

  if (!relevantFiles.length) {
    return toolError('找不到相關檔案');
  }

  const documents: ClaudeDocument[] = relevantFiles.map((f) => ({
    title: f.filename,
    content: (f.content_md || f.full_text || '').slice(0, 20000),
    file_id: f.id,
    doc_type: 'file' as const,
  }));

  // 3. Load law refs specified by relevant_law_ids: JSON cache first, fallback to MongoDB
  if (relevantLawIds.length) {
    const lawDocs = await loadLawDocsByIds(drizzle, caseId, ctx.mongoUrl, relevantLawIds);
    for (const doc of lawDocs) {
      documents.push({ title: doc.title, content: doc.content, doc_type: 'law' as const });
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

  // 6. Post-processing: detect uncited law mentions, fetch and cache
  const citedLawLabels = new Set(citations.filter((c) => c.type === 'law').map((c) => c.label));
  const displayRefs = await fetchAndCacheUncitedMentions(
    drizzle,
    caseId,
    ctx.mongoUrl,
    text,
    citedLawLabels,
  );

  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_law_refs',
    data: displayRefs,
  });

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
  return toolSuccess(
    `${actionLabel}段落「${section}${subsection ? ' > ' + subsection : ''}」，包含 ${fileCitationCount} 個文件引用、${lawCitationCount} 個法條引用。`,
  );
};
