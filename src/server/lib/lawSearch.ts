import { MongoClient } from 'mongodb';
import { resolveAlias, normalizeArticleNo, buildArticleId } from './lawConstants';

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

  // ── Strategy 0: Direct _id Lookup (O(1)) ──
  if (articleMatch) {
    const rawLawName = articleMatch[1].trim();
    const rawArticle = articleMatch[2].trim();
    const resolvedName = resolveAlias(rawLawName);
    const normalizedArticle = normalizeArticleNo(rawArticle);
    const articleId = buildArticleId(resolvedName, normalizedArticle);

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
  if (articleMatch) {
    const rawLawName = articleMatch[1].trim();
    const articleQuery = articleMatch[2].trim();
    const resolvedName = resolveAlias(rawLawName);
    const numMatch = articleQuery.match(/第\s*(\d+)\s*(條.*)/);
    if (numMatch) {
      const articleNum = numMatch[1];
      const suffix = numMatch[2].replace(/條|\s+/g, '');
      const articleRegex = suffix
        ? new RegExp(`第\\s*${articleNum}[-\\s]*${suffix.replace(/之/g, '[-之]\\s*')}\\s*條`)
        : new RegExp(`第\\s*${articleNum}\\s*條(?!\\s*之)(?!.*-)`);
      const directResults = await coll
        .find({
          $or: [{ law_name: resolvedName }, { aliases: { $regex: resolvedName } }],
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

  if (articleMatch) {
    const rawLawName = articleMatch[1].trim();
    const articleQuery = articleMatch[2].trim();
    const resolvedName = resolveAlias(rawLawName);
    compound = {
      must: [
        {
          text: {
            query: resolvedName,
            path: ['law_name', 'aliases'],
            synonyms: 'law_synonyms',
          },
        },
      ],
      should: [{ text: { query: articleQuery, path: 'article_no' } }],
    };
  } else if (lawConceptMatch) {
    const rawLawName = lawConceptMatch[1];
    const resolvedName = resolveAlias(rawLawName);
    const concept = lawConceptMatch[2];
    compound = {
      must: [
        {
          text: {
            query: resolvedName,
            path: ['law_name', 'aliases'],
            synonyms: 'law_synonyms',
          },
        },
      ],
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
            score: { boost: { value: 5 } },
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
    compound.filter = [{ text: { query: nature, path: 'nature' } }];
  }

  const results = await coll
    .aggregate([
      { $search: { index: 'law_search', compound } },
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
    .toArray();

  return results as unknown as LawArticle[];
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
