import { eq, sql, and, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { files, briefs, lawRefs } from "../../db/schema";
import { callClaudeWithCitations, type ClaudeDocument } from "../claudeClient";
import { parseJsonField } from "../toolHelpers";
import { searchLaw } from "../../lib/lawSearch";
import type { Paragraph } from "../../../client/stores/useBriefStore";
import type { ToolHandler } from "./types";

/** Regex to detect law article references like 民法第184條、道路交通安全規則第102條第1項第7款 */
const LAW_ARTICLE_REGEX =
  /([\u4e00-\u9fff]{2,}(?:法|規則|條例|辦法|細則))第(\d+條(?:之\d+)?)/g;

export const handleWriteBriefSection: ToolHandler = async (
  args,
  caseId,
  _db,
  drizzle,
  ctx,
) => {
  if (!ctx) {
    return { result: "Error: missing execution context", success: false };
  }

  const briefId = args.brief_id as string;
  const section = args.section as string;
  const subsection = (args.subsection as string) || "";
  const instruction = args.instruction as string;
  const relevantFileIds = args.relevant_file_ids as string[];
  const relevantLawIds = (args.relevant_law_ids as string[]) || [];
  const disputeId = (args.dispute_id as string) || null;

  if (!briefId || !section || !instruction || !relevantFileIds?.length) {
    return {
      result:
        "Error: brief_id, section, instruction, relevant_file_ids are required",
      success: false,
    };
  }

  // 1. Load file contents for document blocks (prefer content_md for citation chunking)
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
    return { result: "Error: no matching files found", success: false };
  }

  const documents: ClaudeDocument[] = relevantFiles.map((f) => ({
    title: f.filename,
    content: (f.content_md || f.full_text || "").slice(0, 20000),
    file_id: f.id,
    doc_type: "file" as const,
  }));

  // 2a. Load manual law refs (lawyer's curated picks) — always included
  const manualLawRows = await drizzle
    .select()
    .from(lawRefs)
    .where(and(eq(lawRefs.case_id, caseId), eq(lawRefs.source, "manual")));

  const loadedLawIds = new Set<string>();
  for (const ref of manualLawRows) {
    if (ref.full_text) {
      documents.push({
        title: `${ref.law_name} ${ref.article}`,
        content: ref.full_text,
        doc_type: "law" as const,
      });
      loadedLawIds.add(ref.id);
    }
  }

  // 2b. Load agent-specified law refs (relevant_law_ids): D1 cache first, fallback to MongoDB
  if (relevantLawIds.length) {
    const uncachedIds = relevantLawIds.filter((id) => !loadedLawIds.has(id));

    if (uncachedIds.length) {
      // Check D1 cache
      const cachedRows = await drizzle
        .select()
        .from(lawRefs)
        .where(
          and(eq(lawRefs.case_id, caseId), inArray(lawRefs.id, uncachedIds)),
        );

      for (const ref of cachedRows) {
        if (ref.full_text) {
          documents.push({
            title: `${ref.law_name} ${ref.article}`,
            content: ref.full_text,
            doc_type: "law" as const,
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
                  source: "search",
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
                doc_type: "law" as const,
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

  // 3. Call Claude with Citations
  const claudeInstruction = `你是一位專業的台灣律師助理。請根據提供的來源文件和法條，撰寫法律書狀的一個段落。

撰寫要求：
- 章節：${section}
- 子章節：${subsection || "（無）"}
- 指示：${instruction}

撰寫規則：
- 使用正式法律文書用語（繁體中文）
- 論述要有邏輯、條理分明
- 引用法條時，務必從提供的法條文件中引用，讓系統能自動標記引用來源
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 直接撰寫段落內容，不需要加入章節標題
- 段落長度控制在 150-300 字之間，簡潔有力`;

  const { text, segments, citations } = await callClaudeWithCitations(
    ctx.aiEnv,
    documents,
    claudeInstruction,
  );

  // 4. Post-processing: store cited laws in D1 (source='cited'), detect uncited mentions
  const citedLawLabels = new Set(
    citations.filter((c) => c.type === "law").map((c) => c.label),
  );

  // Mark cited laws in D1 as source='cited'
  for (const label of citedLawLabels) {
    const matchingManual = manualLawRows.find(
      (r) => `${r.law_name} ${r.article}` === label,
    );
    if (matchingManual) {
      await drizzle
        .update(lawRefs)
        .set({ source: "cited" })
        .where(eq(lawRefs.id, matchingManual.id));
    }
  }

  // Deduplicate: use Set to avoid redundant MongoDB queries for same law
  const mentionedLawKeys = new Set<string>();
  for (const match of text.matchAll(LAW_ARTICLE_REGEX)) {
    mentionedLawKeys.add(`${match[1]}|第${match[2]}`);
  }

  // Find laws mentioned in text but not cited by Claude — store in D1 as cache
  const uncitedLaws = Array.from(mentionedLawKeys)
    .map((key) => {
      const [lawName, article] = key.split("|");
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
              source: "cited",
            })
            .onConflictDoUpdate({
              target: lawRefs.id,
              set: {
                source: "cited",
                usage_count: sql`coalesce(${lawRefs.usage_count}, 0) + 1`,
              },
            });
        }
      } catch {
        /* skip on error */
      }
    }
  }

  // Send updated law refs (manual + cited only) to frontend
  const displayRefs = await drizzle
    .select()
    .from(lawRefs)
    .where(
      and(
        eq(lawRefs.case_id, caseId),
        inArray(lawRefs.source, ["manual", "cited"]),
      ),
    );

  await ctx.sendSSE({
    type: "brief_update",
    brief_id: "",
    action: "set_law_refs",
    data: displayRefs,
  });

  // 5. Build Paragraph object
  const lawCitationCount = citations.filter((c) => c.type === "law").length;
  const fileCitationCount = citations.filter((c) => c.type === "file").length;

  const paragraph: Paragraph = {
    id: nanoid(),
    section,
    subsection,
    content_md: text,
    segments,
    dispute_id: disputeId,
    citations,
  };

  // 6. Read current brief content and append
  const briefRows = await drizzle
    .select()
    .from(briefs)
    .where(eq(briefs.id, briefId));

  if (!briefRows.length) {
    return {
      result: `Error: brief not found (id: ${briefId})`,
      success: false,
    };
  }

  const brief = briefRows[0];
  const contentStructured = parseJsonField<{ paragraphs: Paragraph[] }>(
    brief.content_structured,
    { paragraphs: [] },
  );

  contentStructured.paragraphs.push(paragraph);

  // 7. Update DB
  await drizzle
    .update(briefs)
    .set({
      content_structured: JSON.stringify(contentStructured),
      updated_at: new Date().toISOString(),
    })
    .where(eq(briefs.id, briefId));

  // 8. Send SSE brief_update
  await ctx.sendSSE({
    type: "brief_update",
    brief_id: briefId,
    action: "add_paragraph",
    data: paragraph,
  });

  return {
    result: `已撰寫段落「${section}${subsection ? " > " + subsection : ""}」，包含 ${fileCitationCount} 個文件引用、${lawCitationCount} 個法條引用。`,
    success: true,
  };
};
