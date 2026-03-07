// ── Step 1: Law Fetch (pure function, no AI) ──
// Deterministic batch lookup of mentioned laws from MongoDB.

import { createLawSearchSession } from '../../lib/lawSearch';
import {
  resolveAlias,
  normalizeArticleNo,
  buildArticleId,
  expandWithCompanions,
} from '../../lib/lawConstants';
import type { LegalIssue, FetchedLaw, LawFetchResult } from './types';
import type { LawRefItem } from '../../lib/lawRefsJson';

// ── Constants ──

const MAX_LAW_CONTENT_LENGTH = 600;

// ── Normalization ──

/**
 * Parse a law reference string like "民法第184條" into lawName + articleNo,
 * then build a canonical MongoDB _id via PCODE_MAP.
 * Returns null if the string can't be parsed or the law isn't in PCODE_MAP.
 */
const parseLawRef = (raw: string): { id: string; lawName: string; articleNo: string } | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try to match "法規名第X條" pattern
  const match = trimmed.match(/^(.+?)\s*(第\s*\S+?\s*條.*)$/);
  if (match) {
    const lawName = resolveAlias(match[1].trim());
    const articleNo = normalizeArticleNo(match[2].trim());
    const id = buildArticleId(lawName, articleNo);
    if (id) return { id, lawName, articleNo };
  }

  // Try as bare article ref (e.g., "民法184" without 第..條)
  const bareMatch = trimmed.match(/^(.+?)\s*(\d[\d-]*)$/);
  if (bareMatch) {
    const lawName = resolveAlias(bareMatch[1].trim());
    const articleNo = normalizeArticleNo(bareMatch[2].trim());
    const id = buildArticleId(lawName, articleNo);
    if (id) return { id, lawName, articleNo };
  }

  return null;
};

/**
 * Collect all mentioned law IDs from issues, deduplicate by canonical _id.
 */
const collectMentionedLawIds = (
  issues: LegalIssue[],
): Map<string, { lawName: string; articleNo: string }> => {
  const result = new Map<string, { lawName: string; articleNo: string }>();
  for (const issue of issues) {
    for (const raw of issue.mentioned_laws) {
      const parsed = parseLawRef(raw);
      if (parsed && !result.has(parsed.id)) {
        result.set(parsed.id, { lawName: parsed.lawName, articleNo: parsed.articleNo });
      }
    }
  }
  return result;
};

// ── Truncation helper (for Step 2 input only, NOT for Writer) ──

export const truncateLawContent = (law: FetchedLaw): FetchedLaw => {
  if (law.content.length <= MAX_LAW_CONTENT_LENGTH) return law;
  return {
    ...law,
    content: law.content.slice(0, MAX_LAW_CONTENT_LENGTH) + '...（截斷）',
  };
};

// ── Helpers ──

const addLaw = (
  laws: Map<string, FetchedLaw>,
  id: string,
  lawName: string,
  articleNo: string,
  content: string,
  source: FetchedLaw['source'],
) => {
  if (!laws.has(id)) {
    laws.set(id, { id, law_name: lawName, article_no: articleNo, content, source });
  }
};

// ── Main function ──

export const runLawFetch = async (
  mongoUrl: string,
  input: {
    legalIssues: LegalIssue[];
    userAddedLaws: LawRefItem[];
    existingLawRefs: LawRefItem[];
  },
  apiKey?: string,
): Promise<LawFetchResult> => {
  const laws = new Map<string, FetchedLaw>();

  // 1. Collect and normalize all mentioned law IDs
  const mentionedIds = collectMentionedLawIds(input.legalIssues);

  // 1.5 Expand with companion laws
  const expandedIds = expandWithCompanions(mentionedIds);

  // 2. Add existing cached laws (skip MongoDB lookup for these)
  const cachedIds = new Set<string>();
  for (const ref of input.existingLawRefs) {
    if (!ref.is_manual && ref.full_text && expandedIds.has(ref.id)) {
      cachedIds.add(ref.id);
      addLaw(laws, ref.id, ref.law_name, ref.article, ref.full_text, 'mentioned');
    }
  }

  // 3. Batch lookup uncached mentioned laws from MongoDB
  const uncachedIds = [...expandedIds.keys()].filter((id) => !cachedIds.has(id));

  if (uncachedIds.length > 0) {
    const session = createLawSearchSession(mongoUrl, apiKey);
    try {
      // Try batch lookup by _id first (fastest)
      const results = await session.batchLookupByIds(uncachedIds);
      for (const r of results) {
        addLaw(laws, r._id, r.law_name, r.article_no, r.content, 'mentioned');
      }

      // Fallback: batch search for IDs not found by batch lookup
      const missingEntries = [...expandedIds.entries()].filter(([id]) => !laws.has(id));
      if (missingEntries.length > 0) {
        const fallbackResults = await Promise.all(
          missingEntries.map(([, meta]) => session.search(`${meta.lawName}${meta.articleNo}`, 1)),
        );
        for (const searchResults of fallbackResults) {
          if (searchResults.length > 0) {
            const r = searchResults[0];
            addLaw(laws, r._id, r.law_name, r.article_no, r.content, 'mentioned');
          }
        }
      }
    } finally {
      await session.close();
    }
  }

  // 4. Add user manual laws
  for (const ref of input.userAddedLaws) {
    if (ref.is_manual && ref.full_text) {
      addLaw(laws, ref.id, ref.law_name, ref.article, ref.full_text, 'user_manual');
    }
  }

  return { laws, total: laws.size };
};
