import { batchLookupLawsByIds } from './lawSearch';
import { resolveAlias, normalizeArticleNo, buildArticleId } from './lawConstants';
import { hasReplacementChars, buildLawTextMap, repairLawCitations } from './textSanitize';
import { readLawRefs, upsertManyLawRefs, hasLawRefByNameArticle } from './lawRefsJson';
import type { LawRefItem } from './lawRefsJson';
import type { getDB } from '../db';

type Drizzle = ReturnType<typeof getDB>;

/** Regex to detect law article references like 民法第184條、道路交通安全規則第102條第1項第7款 */
export const LAW_ARTICLE_REGEX =
  /([\u4e00-\u9fff]{2,}(?:法|規則|條例|辦法|細則))第(\d+條(?:之\d+)?)/g;

/**
 * Load law documents by IDs — cache-first with MongoDB fallback.
 * Returns loaded docs (id, title, content) ready for ClaudeDocument construction.
 * Automatically caches any newly fetched laws.
 */
export const loadLawDocsByIds = async (
  drizzle: Drizzle,
  caseId: string,
  mongoUrl: string,
  lawIds: string[],
): Promise<Array<{ id: string; title: string; content: string }>> => {
  if (!lawIds.length) return [];

  const cachedRefs = await readLawRefs(drizzle, caseId);
  const cachedById = new Map(cachedRefs.map((r) => [r.id, r]));

  const loaded: Array<{ id: string; title: string; content: string }> = [];
  const loadedIds = new Set<string>();

  // Phase 1: load from cache
  for (const id of lawIds) {
    const ref = cachedById.get(id);
    if (ref && ref.full_text) {
      loaded.push({ id: ref.id, title: `${ref.law_name} ${ref.article}`, content: ref.full_text });
      loadedIds.add(ref.id);
    }
  }

  // Phase 2: batch fetch missing from MongoDB (single $in query)
  const stillMissing = lawIds.filter((id) => !loadedIds.has(id));
  if (stillMissing.length && mongoUrl) {
    try {
      const results = await batchLookupLawsByIds(mongoUrl, stillMissing);
      const toCache: LawRefItem[] = [];
      for (const r of results) {
        if (hasReplacementChars(r.content)) {
          console.warn(`Skipping corrupted law text from MongoDB: ${r._id}`);
          continue;
        }
        loaded.push({
          id: r._id,
          title: `${r.law_name} ${r.article_no}`,
          content: r.content,
        });
        loadedIds.add(r._id);
        toCache.push({
          id: r._id,
          law_name: r.law_name,
          article: r.article_no,
          full_text: r.content,
          is_manual: false,
        });
      }
      if (toCache.length) {
        await upsertManyLawRefs(drizzle, caseId, toCache);
      }
    } catch {
      /* skip on error */
    }
  }

  return loaded;
};

/**
 * Detect law mentions in text that aren't already cited,
 * fetch them from MongoDB, cache in JSON, and return updated refs.
 */
export const fetchAndCacheUncitedMentions = async (
  drizzle: Drizzle,
  caseId: string,
  mongoUrl: string,
  text: string,
  citedLawLabels: Set<string>,
): Promise<LawRefItem[]> => {
  const mentionedLawKeys = new Set<string>();
  for (const match of text.matchAll(LAW_ARTICLE_REGEX)) {
    mentionedLawKeys.add(`${match[1]}|第${match[2]}`);
  }

  const uncitedLaws = Array.from(mentionedLawKeys)
    .map((key) => {
      const [lawName, article] = key.split('|');
      return { lawName, article };
    })
    .filter((m) => !citedLawLabels.has(`${m.lawName} ${m.article}`));

  if (uncitedLaws.length > 0 && mongoUrl) {
    const currentRefs = await readLawRefs(drizzle, caseId);

    // Filter out already-cached laws, then build _id list for batch lookup
    const toBatch = uncitedLaws.filter(
      (law) => !hasLawRefByNameArticle(currentRefs, law.lawName, law.article),
    );

    if (toBatch.length) {
      const idsToFetch: string[] = [];
      for (const law of toBatch) {
        const resolved = resolveAlias(law.lawName);
        const normalized = normalizeArticleNo(law.article);
        const articleId = buildArticleId(resolved, normalized);
        if (articleId) idsToFetch.push(articleId);
      }

      if (idsToFetch.length) {
        try {
          const results = await batchLookupLawsByIds(mongoUrl, idsToFetch);
          const toCache: LawRefItem[] = [];
          for (const r of results) {
            if (hasReplacementChars(r.content)) {
              console.warn(`Skipping corrupted law text from MongoDB: ${r._id}`);
              continue;
            }
            toCache.push({
              id: r._id,
              law_name: r.law_name,
              article: r.article_no,
              full_text: r.content,
              is_manual: false,
            });
          }
          if (toCache.length) {
            await upsertManyLawRefs(drizzle, caseId, toCache);
          }
        } catch {
          /* skip on error */
        }
      }
    }
  }

  return readLawRefs(drizzle, caseId);
};

/**
 * Repair corrupted law citations using cached law text,
 * and return the current law refs (for SSE push or further use).
 */
export const repairAndGetRefs = async (
  drizzle: Drizzle,
  caseId: string,
  citations: Array<{ type: string; label: string; quoted_text?: string | null }>,
): Promise<LawRefItem[]> => {
  const refs = await readLawRefs(drizzle, caseId);
  const lawTextMap = buildLawTextMap(refs);
  repairLawCitations(citations, lawTextMap);
  return refs;
};
