import { MongoClient, type Db } from 'mongodb';
import {
  resolveAlias,
  normalizeArticleNo,
  buildArticleId,
  tryRewriteQuery,
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

// ── DB Synonyms Loading ──

/** Module-level TTL cache for synonym alias map (avoids full collection scan per request) */
let _aliasCache: { data: Record<string, string>; ts: number } | null = null;
const ALIAS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load synonyms from lawdb.synonyms collection and convert to alias map.
 * Each synonym doc has { _id, mappingType, synonyms: ["term1", "term2", ...] }.
 * Returns a Record<string, string> mapping each alias → canonical name (first synonym).
 * Results are cached with a 5-minute TTL at the module level.
 */
const loadSynonymsAsAliasMap = async (db: Db): Promise<Record<string, string>> => {
  if (_aliasCache && Date.now() - _aliasCache.ts < ALIAS_CACHE_TTL) {
    return _aliasCache.data;
  }
  const aliasMap: Record<string, string> = {};
  try {
    const synonymsColl = db.collection('synonyms');
    const docs = await synonymsColl.find({}).toArray();
    for (const doc of docs) {
      const terms = doc.synonyms as string[] | undefined;
      if (!terms || terms.length < 2) continue;
      // First term is the canonical name, all others map to it
      const canonical = terms[0];
      for (let i = 1; i < terms.length; i++) {
        aliasMap[terms[i]] = canonical;
      }
    }
  } catch (err) {
    console.warn('loadSynonymsAsAliasMap failed:', err);
  }
  _aliasCache = { data: aliasMap, ts: Date.now() };
  return aliasMap;
};

// ── Embedding & Vector Search ──

/**
 * Call Voyage AI embedding API to get a 512-dim vector for the given text.
 */
const embedQuery = async (text: string, apiKey: string): Promise<number[]> => {
  const res = await fetch('https://ai.mongodb.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-3.5',
      input: [text],
      input_type: 'query',
      output_dimension: 512,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Embedding API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { embedding: number[] }[];
  };
  if (!json.data?.[0]?.embedding) {
    throw new Error(`Embedding API returned no data: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.data[0].embedding;
};

const SHARED_PROJECT = {
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
};

/**
 * Run $vectorSearch with optional pcode/nature pre-filter.
 * Requires Atlas vector_index to have filter fields configured.
 */
const filteredVectorSearch = async (
  coll: Collection,
  queryVector: number[],
  limit: number,
  filter?: { pcode?: string; nature?: string },
): Promise<LawArticle[]> => {
  const searchFilter: Record<string, unknown> = {};
  if (filter?.pcode) searchFilter.pcode = { $eq: filter.pcode };
  if (filter?.nature) searchFilter.nature = { $eq: filter.nature };

  return coll
    .aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector,
          numCandidates: limit * 10,
          limit,
          ...(Object.keys(searchFilter).length > 0 && { filter: searchFilter }),
        },
      },
      { $project: { ...SHARED_PROJECT, score: { $meta: 'vectorSearchScore' } } },
    ])
    .toArray() as unknown as Promise<LawArticle[]>;
};

/**
 * Vector-first merge: vector results ranked first (superior semantic relevance),
 * keyword results fill remaining slots (deduplicated).
 * Experimentally validated: MRR 0.536 vs RRF's 0.353 on 22-query benchmark.
 */
const vectorFirstMerge = (
  keywordResults: LawArticle[],
  vectorResults: LawArticle[],
  limit: number,
): LawArticle[] => {
  const seen = new Set<string>();
  const out: LawArticle[] = [];

  // Vector results first — better semantic ranking
  for (const r of vectorResults) {
    if (!seen.has(r._id)) {
      seen.add(r._id);
      out.push({ ...r, score: 1 - out.length * 0.01 }); // descending score for ordering
    }
  }

  // Keyword backfill — adds diversity, catches exact matches vector may miss
  for (const r of keywordResults) {
    if (!seen.has(r._id) && out.length < limit) {
      seen.add(r._id);
      out.push({ ...r, score: 0.5 - out.length * 0.01 });
    }
  }

  return out.slice(0, limit);
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

/** Append a nature filter clause to an Atlas Search compound query */
const applyNatureFilter = (compound: Record<string, unknown>, nature?: string) => {
  if (!nature) return;
  const existing = (compound.filter as unknown[]) || [];
  compound.filter = [...existing, { text: { query: nature, path: 'nature' } }];
};

interface SearchOpts {
  limit: number;
  nature?: string;
  apiKey?: string;
  dbAliases?: Record<string, string>;
  lawName?: string;
}

/**
 * Internal: search with an existing collection handle.
 * All search strategies are here — no other function should duplicate this logic.
 *
 * Query classification:
 *   ├─ 條號查詢 → S0 direct _id / S1 regex / S2 Atlas keyword（不變）
 *   └─ 概念查詢 → Hybrid search（keyword + vector → vector-first merge）：
 *       1. 判斷 lawName + concept（opts.lawName / regex / tryExtractLawName / CONCEPT_TO_LAW）
 *       2. 有 apiKey → keyword + filteredVector 平行 → vector-first merge
 *       3. 無 apiKey → keyword only（graceful fallback）
 */
const searchWithCollection = async (
  coll: Collection,
  query: string,
  opts: SearchOpts,
): Promise<LawArticle[]> => {
  const { limit, nature, apiKey, dbAliases, lawName } = opts;
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
    artResolvedName = resolveAlias(articleMatch[1].trim(), dbAliases);
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

  // ── Helper: run Atlas Search keyword query ──
  const runAtlasSearch = async (c: Record<string, unknown>): Promise<LawArticle[]> =>
    coll
      .aggregate([
        { $search: { index: 'law_search', compound: c } },
        { $limit: safeLimit },
        {
          $project: {
            ...SHARED_PROJECT,
            score: { $meta: 'searchScore' },
          },
        },
      ])
      .toArray() as unknown as Promise<LawArticle[]>;

  // ── Build Atlas Search compound query ──

  if (articleMatch && artResolvedName && artNormalized) {
    // S2: article search via Atlas
    const compound: Record<string, unknown> = {
      ...buildLawClause(artResolvedName),
      should: [{ phrase: { query: artNormalized, path: 'article_no' } }],
    };
    applyNatureFilter(compound, nature);
    return runAtlasSearch(compound);
  }

  // ── Concept search: unified hybrid (keyword + vector → vector-first merge) ──
  // 1. Determine lawName + concept from: opts.lawName, regex, tryExtractLawName, or CONCEPT_TO_LAW
  // 2. Resolve pcode from lawName
  // 3. Run keyword + vector in parallel → vector-first merge (or keyword-only if no apiKey)

  // Step 1: Extract law name and concept
  let resolvedLawName: string | undefined;
  let keywordConcept: string; // concept text for keyword search

  if (lawName) {
    // Explicit lawName from tool parameter — highest priority
    resolvedLawName = resolveAlias(lawName, dbAliases);
    keywordConcept = query;
  } else if (lawConceptMatch) {
    // "民法 損害賠償" pattern
    resolvedLawName = resolveAlias(lawConceptMatch[1], dbAliases);
    keywordConcept = lawConceptMatch[2];
  } else {
    const extracted = !articleMatch ? tryExtractLawName(query) : null;
    if (extracted) {
      // "民法過失相抵" pattern (no space)
      resolvedLawName = resolveAlias(extracted.lawName, dbAliases);
      keywordConcept = extracted.concept;
    } else {
      // Pure concept — try CONCEPT_TO_LAW rewrite for keyword optimization
      const rw = tryRewriteQuery(query);
      if (rw) {
        resolvedLawName = resolveAlias(rw.lawName, dbAliases);
        keywordConcept = rw.concept;
      } else {
        // No law identified — unscoped search
        resolvedLawName = undefined;
        keywordConcept = query;
      }
    }
  }

  // Step 2: Resolve pcode for filtering
  const pcode = resolvedLawName ? PCODE_MAP[resolvedLawName] : undefined;

  // Step 3: Build keyword compound query
  const buildConceptKeywordCompound = (): Record<string, unknown> => {
    const compound: Record<string, unknown> = resolvedLawName
      ? {
          ...buildLawClause(resolvedLawName),
          should: [
            {
              text: {
                query: keywordConcept,
                path: 'chapter',
                score: { boost: { value: 5 } },
              },
            },
            {
              text: {
                query: keywordConcept,
                path: 'content',
                score: { boost: { value: 3 } },
              },
            },
            {
              text: {
                query: keywordConcept,
                path: 'category',
              },
            },
          ],
          minimumShouldMatch: 1,
        }
      : {
          should: [
            {
              text: {
                query: keywordConcept,
                path: ['law_name', 'aliases'],
                score: { boost: { value: 1.5 } },
              },
            },
            {
              text: {
                query: keywordConcept,
                path: 'chapter',
                score: { boost: { value: 3 } },
              },
            },
            {
              text: {
                query: keywordConcept,
                path: 'content',
              },
            },
            {
              text: {
                query: keywordConcept,
                path: 'category',
                score: { boost: { value: 0.5 } },
              },
            },
          ],
          minimumShouldMatch: 1,
        };
    applyNatureFilter(compound, nature);
    return compound;
  };

  // Step 4: Run hybrid or keyword-only
  if (apiKey) {
    // Hybrid: keyword + vector in parallel → vector-first merge
    try {
      const queryVector = await embedQuery(query, apiKey);
      const [kwResults, vecResults] = await Promise.all([
        runAtlasSearch(buildConceptKeywordCompound()),
        filteredVectorSearch(coll, queryVector, safeLimit, {
          pcode,
          nature,
        }),
      ]);
      const merged = vectorFirstMerge(kwResults, vecResults, safeLimit);
      if (merged.length > 0) return merged;
    } catch (err) {
      // Vector/embedding failed — fall through to keyword-only
      console.warn('[lawSearch] Hybrid search failed, falling back to keyword:', err);
    }
  }

  // Keyword-only fallback (no apiKey or hybrid failed)
  return runAtlasSearch(buildConceptKeywordCompound());
};

// ── Public APIs (manage MongoClient lifecycle, delegate to core) ──

/**
 * One-shot search: creates a MongoClient, searches, then closes.
 * MUST create per-request — Workers don't maintain TCP sockets between requests.
 */
export const searchLaw = async (
  mongoUrl: string,
  opts: {
    query: string;
    limit?: number;
    nature?: string;
    apiKey?: string;
    lawName?: string;
  },
): Promise<LawArticle[]> => {
  const { query, limit: rawLimit, nature, apiKey, lawName } = opts;

  if (!mongoUrl) {
    console.warn('searchLaw: MONGO_URL not set');
    return [];
  }

  const client = new MongoClient(mongoUrl, MONGO_OPTS);

  try {
    const db = client.db('lawdb');
    const coll = db.collection('articles');
    const dbAliases = await loadSynonymsAsAliasMap(db);
    return await searchWithCollection(coll, query, {
      limit: rawLimit || 10,
      nature,
      apiKey,
      dbAliases,
      lawName,
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
  search: (query: string, limit?: number, lawName?: string) => Promise<LawArticle[]>;
  batchLookupByIds: (ids: string[]) => Promise<LawArticle[]>;
  close: () => Promise<void>;
}

export const createLawSearchSession = (mongoUrl: string, apiKey?: string): LawSearchSession => {
  const client = new MongoClient(mongoUrl, MONGO_OPTS);
  let connected = false;
  let cachedAliases: Record<string, string> | undefined;

  const ensureConnected = async () => {
    if (!connected) {
      await client.connect();
      connected = true;
      // Load DB synonyms once per session
      cachedAliases = await loadSynonymsAsAliasMap(client.db('lawdb'));
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
    search: async (query: string, limit?: number, lawName?: string): Promise<LawArticle[]> => {
      if (!mongoUrl) return [];
      await ensureConnected();
      const coll = client.db('lawdb').collection('articles');
      return searchWithCollection(coll, query, {
        limit: limit || 5,
        apiKey,
        dbAliases: cachedAliases,
        lawName,
      });
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
