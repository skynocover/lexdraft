import { MongoClient } from 'mongodb';
import {
  resolveAlias,
  normalizeArticleNo,
  buildArticleId,
  PCODE_MAP,
  ALIAS_MAP,
} from './lawConstants';

export interface LawArticle {
  _id: string;
  pcode: string;
  law_name: string;
  nature: string;
  category: string;
  chapter: string;
  article_no: string;
  content: string;
  aliases?: string;
  last_update: string;
  url: string;
  score: number;
}

/** Matches "民法第213條", "民法 第213條之1", "消保法第7條" etc. */
const ARTICLE_REGEX = /^(.+?)\s*(第\s*\S+?\s*條.*)$/;

/** Matches "民法 損害賠償", "勞動基準法 工時" — law name + concept */
const LAW_CONCEPT_REGEX = /^([\u4e00-\u9fff]+(?:法|規則|條例|辦法|細則))\s+(.+)$/;

const buildUrl = (pcode: string): string =>
  `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${pcode}`;

/** Atlas Search compound query 的法規篩選子句：有 pcode 用 filter，沒有則 fallback text match */
const buildLawClause = (name: string): { filter?: unknown[]; must?: unknown[] } => {
  const pcode = PCODE_MAP[name];
  if (pcode) {
    return { filter: [{ text: { query: pcode, path: 'pcode' } }] };
  }
  return {
    must: [
      {
        text: {
          query: name,
          path: ['law_name', 'aliases'],
          synonyms: 'law_synonyms',
        },
      },
    ],
  };
};

/**
 * Pre-sorted law names (PCODE_MAP keys + ALIAS_MAP keys), longest first.
 * Used by tryExtractLawName to greedily match the longest known law name prefix.
 */
const SORTED_LAW_NAMES = [...new Set([...Object.keys(PCODE_MAP), ...Object.keys(ALIAS_MAP)])].sort(
  (a, b) => b.length - a.length,
);

/**
 * Try to extract a known law name prefix from a query string (without spaces).
 * e.g. "民法過失相抵" → { lawName: "民法", concept: "過失相抵" }
 * e.g. "勞基法加班費" → { lawName: "勞基法", concept: "加班費" }
 * Returns null if no known law name prefix is found or no remaining concept text.
 */
const tryExtractLawName = (query: string): { lawName: string; concept: string } | null => {
  const trimmed = query.trim();
  for (const name of SORTED_LAW_NAMES) {
    if (trimmed.startsWith(name) && trimmed.length > name.length) {
      const concept = trimmed.slice(name.length).trim();
      if (concept) {
        return { lawName: name, concept };
      }
    }
  }
  return null;
};

/** 遞迴移除物件中所有 `synonyms` 欄位（用於 fallback 重搜） */
const stripSynonyms = (obj: unknown): unknown => {
  if (Array.isArray(obj)) return obj.map(stripSynonyms);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'synonyms') continue;
      out[k] = stripSynonyms(v);
    }
    return out;
  }
  return obj;
};

const MONGO_OPTS = {
  maxPoolSize: 1,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 10000,
  maxIdleTimeMS: 3000,
  waitQueueTimeoutMS: 5000,
};

// ── Core search implementation (reused by all public APIs) ──

type Collection = ReturnType<ReturnType<MongoClient['db']>['collection']>;

interface SearchOpts {
  limit: number;
  nature?: string;
}

/**
 * Internal: search with an existing collection handle.
 * All search strategies are here — no other function should duplicate this logic.
 */
const searchWithCollection = async (
  coll: Collection,
  query: string,
  opts: SearchOpts,
): Promise<LawArticle[]> => {
  const { limit, nature } = opts;
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  // Guard: empty query would crash MongoDB Atlas Search compound.should[].text.query
  if (!query.trim()) {
    return [];
  }

  const articleMatch = query.match(ARTICLE_REGEX);
  const lawConceptMatch = !articleMatch ? query.match(LAW_CONCEPT_REGEX) : null;

  // Pre-parse article match fields once (shared by S0, S1, S2)
  let artResolvedName: string | undefined;
  let artRawArticle: string | undefined;
  let artNormalized: string | undefined;

  if (articleMatch) {
    artResolvedName = resolveAlias(articleMatch[1].trim());
    artRawArticle = articleMatch[2].trim();
    artNormalized = normalizeArticleNo(artRawArticle);
  }

  // ── Strategy 0: Direct _id Lookup (O(1)) ──
  if (articleMatch && artResolvedName && artNormalized) {
    const articleId = buildArticleId(artResolvedName, artNormalized);

    if (articleId) {
      const doc = await coll.findOne({ _id: articleId } as Record<string, unknown>);
      if (doc) {
        return [
          {
            ...doc,
            url: buildUrl(doc.pcode as string),
            score: 1,
          } as unknown as LawArticle,
        ];
      }
    }
  }

  // ── Strategy 1: Exact article with regex (e.g. "民法第213條") ──
  if (articleMatch && artResolvedName && artRawArticle) {
    const numMatch = artRawArticle.match(/第\s*(\d+)\s*(條.*)/);
    if (numMatch) {
      const articleNum = numMatch[1];
      const suffix = numMatch[2].replace(/條|\s+/g, '');
      const articleRegex = suffix
        ? new RegExp(`第\\s*${articleNum}[-\\s]*${suffix.replace(/之/g, '[-之]\\s*')}\\s*條`)
        : new RegExp(`第\\s*${articleNum}\\s*條(?!\\s*之)(?!.*-)`);
      const directResults = await coll
        .find({
          $or: [{ law_name: artResolvedName }, { aliases: { $regex: artResolvedName } }],
          article_no: { $regex: articleRegex },
        })
        .limit(safeLimit)
        .toArray();

      if (directResults.length > 0) {
        return directResults.map((r) => ({
          ...r,
          url: buildUrl(r.pcode as string),
          score: 1,
        })) as unknown as LawArticle[];
      }
    }
  }

  // ── Build Atlas Search compound query ──
  let compound: Record<string, unknown>;

  if (articleMatch && artResolvedName && artNormalized) {
    compound = {
      ...buildLawClause(artResolvedName),
      should: [{ phrase: { query: artNormalized, path: 'article_no' } }],
    };
  } else if (lawConceptMatch || (!articleMatch && tryExtractLawName(query))) {
    // Handles both "民法 過失相抵" (with space, via regex) and "民法過失相抵" (no space, via tryExtractLawName)
    const extracted = lawConceptMatch
      ? { lawName: lawConceptMatch[1], concept: lawConceptMatch[2] }
      : tryExtractLawName(query)!;
    const resolvedName = resolveAlias(extracted.lawName);
    const concept = extracted.concept;
    compound = {
      ...buildLawClause(resolvedName),
      should: [
        {
          text: {
            query: concept,
            path: 'chapter',
            synonyms: 'law_synonyms',
            score: { boost: { value: 5 } },
          },
        },
        {
          text: {
            query: concept,
            path: 'content',
            synonyms: 'law_synonyms',
            score: { boost: { value: 3 } },
          },
        },
        {
          text: {
            query: concept,
            path: 'category',
            synonyms: 'law_synonyms',
          },
        },
      ],
      minimumShouldMatch: 1,
    };
  } else {
    compound = {
      should: [
        {
          text: {
            query,
            path: ['law_name', 'aliases'],
            synonyms: 'law_synonyms',
            score: { boost: { value: 1.5 } },
          },
        },
        {
          text: {
            query,
            path: 'chapter',
            synonyms: 'law_synonyms',
            score: { boost: { value: 3 } },
          },
        },
        {
          text: {
            query,
            path: 'content',
            synonyms: 'law_synonyms',
          },
        },
        {
          text: {
            query,
            path: 'category',
            synonyms: 'law_synonyms',
            score: { boost: { value: 0.5 } },
          },
        },
      ],
      minimumShouldMatch: 1,
    };
  }

  if (nature) {
    const existing = (compound.filter as unknown[]) || [];
    compound.filter = [...existing, { text: { query: nature, path: 'nature' } }];
  }

  const runAtlasSearch = async (c: Record<string, unknown>): Promise<LawArticle[]> =>
    coll
      .aggregate([
        { $search: { index: 'law_search', compound: c } },
        { $limit: safeLimit },
        {
          $project: {
            _id: 1,
            pcode: 1,
            law_name: 1,
            nature: 1,
            category: 1,
            chapter: 1,
            article_no: 1,
            content: 1,
            aliases: 1,
            last_update: 1,
            url: {
              $concat: ['https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=', '$pcode'],
            },
            score: { $meta: 'searchScore' },
          },
        },
      ])
      .toArray() as unknown as Promise<LawArticle[]>;

  const results = await runAtlasSearch(compound);

  // Fallback: if concept search returns 0 results, retry without synonyms.
  // Synonyms can sometimes reduce recall by redirecting to unrelated terms.
  if (results.length === 0 && !articleMatch) {
    return runAtlasSearch(stripSynonyms(compound) as Record<string, unknown>);
  }

  return results;
};

// ── Public APIs (manage MongoClient lifecycle, delegate to core) ──

/**
 * One-shot search: creates a MongoClient, searches, then closes.
 * MUST create per-request — Workers don't maintain TCP sockets between requests.
 */
export const searchLaw = async (
  mongoUrl: string,
  opts: { query: string; limit?: number; nature?: string },
): Promise<LawArticle[]> => {
  const { query, limit: rawLimit, nature } = opts;

  if (!mongoUrl) {
    console.warn('searchLaw: MONGO_URL not set');
    return [];
  }

  const client = new MongoClient(mongoUrl, MONGO_OPTS);

  try {
    const coll = client.db('lawdb').collection('articles');
    return await searchWithCollection(coll, query, {
      limit: rawLimit || 10,
      nature,
    });
  } finally {
    await client.close().catch(() => {});
  }
};

/**
 * One-shot batch lookup: find multiple articles by _id using $in.
 * Creates a MongoClient, queries, then closes.
 */
export const batchLookupLawsByIds = async (
  mongoUrl: string,
  ids: string[],
): Promise<LawArticle[]> => {
  if (!mongoUrl || !ids.length) return [];

  const client = new MongoClient(mongoUrl, MONGO_OPTS);
  try {
    const coll = client.db('lawdb').collection('articles');
    const docs = await coll
      .find({ _id: { $in: ids } as unknown as Record<string, unknown> })
      .project({
        _id: 1,
        pcode: 1,
        law_name: 1,
        nature: 1,
        category: 1,
        chapter: 1,
        article_no: 1,
        content: 1,
        aliases: 1,
        last_update: 1,
      })
      .toArray();
    return docs.map((d) => ({
      ...d,
      url: buildUrl(d.pcode as string),
      score: 1,
    })) as unknown as LawArticle[];
  } finally {
    await client.close().catch(() => {});
  }
};

/**
 * Create a reusable LawSearch session.
 * Use within a single pipeline run to avoid creating multiple MongoClient instances.
 * MUST call close() when done.
 */
export interface LawSearchSession {
  search: (query: string, limit?: number) => Promise<LawArticle[]>;
  batchLookupByIds: (ids: string[]) => Promise<LawArticle[]>;
  close: () => Promise<void>;
}

export const createLawSearchSession = (mongoUrl: string): LawSearchSession => {
  const client = new MongoClient(mongoUrl, MONGO_OPTS);
  let connected = false;

  const ensureConnected = async () => {
    if (!connected) {
      await client.connect();
      connected = true;
      // Suppress EventEmitter warnings on internal topology/pool emitters
      try {
        const topology = (client as unknown as Record<string, unknown>).topology;
        if (
          topology &&
          typeof (topology as { setMaxListeners?: (n: number) => void }).setMaxListeners ===
            'function'
        ) {
          (topology as { setMaxListeners: (n: number) => void }).setMaxListeners(30);
        }
      } catch {
        /* ignore if internal API differs */
      }
    }
  };

  return {
    search: async (query: string, limit?: number): Promise<LawArticle[]> => {
      if (!mongoUrl) return [];
      await ensureConnected();
      const coll = client.db('lawdb').collection('articles');
      return searchWithCollection(coll, query, { limit: limit || 5 });
    },
    batchLookupByIds: async (ids: string[]): Promise<LawArticle[]> => {
      if (!mongoUrl || !ids.length) return [];
      await ensureConnected();
      const coll = client.db('lawdb').collection('articles');
      const docs = await coll
        .find({ _id: { $in: ids } as unknown as Record<string, unknown> })
        .project({
          _id: 1,
          pcode: 1,
          law_name: 1,
          nature: 1,
          category: 1,
          chapter: 1,
          article_no: 1,
          content: 1,
          aliases: 1,
          last_update: 1,
        })
        .toArray();
      return docs.map((d) => ({
        ...d,
        url: buildUrl(d.pcode as string),
        score: 1,
      })) as unknown as LawArticle[];
    },
    close: async () => {
      await client.close().catch(() => {});
    },
  };
};
