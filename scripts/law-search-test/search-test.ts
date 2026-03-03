/**
 * Law Search 綜合測試
 *
 * 驗證 src/server/lib/lawSearch.ts 所有搜尋策略的正確性與效能。
 * 模擬 searchWithCollection 的完整邏輯，直接連 MongoDB Atlas 測試。
 * 支援 keyword-only 和 hybrid (keyword+vector) 測試。
 *
 * 使用方式: npx tsx scripts/law-search-test/search-test.ts
 */
import { MongoClient, type Collection } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PCODE_MAP,
  ALIAS_MAP,
  CONCEPT_TO_LAW,
  resolveAlias,
  normalizeArticleNo,
  buildArticleId,
  tryRewriteQuery,
  tryExtractLawName,
  extractArticleNum,
  ARTICLE_REGEX,
  LAW_CONCEPT_REGEX,
} from '../../src/server/lib/lawConstants';

// ── 讀取 .dev.vars ──
const loadDevVars = (): { mongoUrl?: string; apiKey?: string } => {
  try {
    const devVars = readFileSync(resolve('dist/lexdraft/.dev.vars'), 'utf-8');
    const mongoMatch = devVars.match(/MONGO_URL\s*=\s*"?([^\s"]+)"?/);
    const apiKeyMatch = devVars.match(/MONGO_API_KEY\s*=\s*"?([^\s"]+)"?/);
    return {
      mongoUrl: mongoMatch?.[1] || process.env.MONGO_URL,
      apiKey: apiKeyMatch?.[1] || process.env.MONGO_API_KEY,
    };
  } catch {
    return {
      mongoUrl: process.env.MONGO_URL,
      apiKey: process.env.MONGO_API_KEY,
    };
  }
};

const { mongoUrl: MONGO_URL, apiKey: MONGO_API_KEY } = loadDevVars();

if (!MONGO_URL) {
  console.error(
    'Error: MONGO_URL not found. Place it in dist/lexdraft/.dev.vars or set as env var.',
  );
  process.exit(1);
}

if (!MONGO_API_KEY) {
  console.warn(
    'Warning: MONGO_API_KEY not found. Hybrid/vector tests will be skipped (keyword-only mode).',
  );
}

// ── buildLawClause (from lawSearch.ts) ──

const buildLawClause = (resolvedName: string): { filter?: unknown[]; must?: unknown[] } => {
  const pcode = PCODE_MAP[resolvedName];
  if (pcode) {
    return { filter: [{ text: { query: pcode, path: 'pcode' } }] };
  }
  return {
    must: [{ text: { query: resolvedName, path: ['law_name', 'aliases'] } }],
  };
};

// ── Embedding & Vector Search ──

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
  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  if (!json.data?.[0]?.embedding) {
    throw new Error('Embedding API returned no data');
  }
  return json.data[0].embedding;
};

interface SearchResult {
  _id: string;
  pcode?: string;
  law_name: string;
  article_no: string;
  content?: string;
  chapter?: string;
  score: number;
  source?: string;
  contentPreview?: string;
}

const filteredVectorSearch = async (
  coll: Collection,
  queryVector: number[],
  limit: number,
  filter: { pcode?: string; nature?: string } = {},
): Promise<SearchResult[]> => {
  const searchFilter: Record<string, unknown> = {};
  if (filter.pcode) searchFilter.pcode = { $eq: filter.pcode };
  if (filter.nature) searchFilter.nature = { $eq: filter.nature };

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
      {
        $project: {
          _id: 1,
          pcode: 1,
          law_name: 1,
          article_no: 1,
          content: 1,
          chapter: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])
    .toArray() as unknown as Promise<SearchResult[]>;
};

const vectorFirstMerge = (
  keywordResults: SearchResult[],
  vectorResults: SearchResult[],
  limit: number,
): SearchResult[] => {
  const seen = new Set<string>();
  const out: SearchResult[] = [];

  for (const r of vectorResults) {
    if (!seen.has(r._id)) {
      seen.add(r._id);
      out.push({ ...r, score: 1 - out.length * 0.01, source: 'vector' });
    }
  }

  for (const r of keywordResults) {
    if (!seen.has(r._id) && out.length < limit) {
      seen.add(r._id);
      out.push({ ...r, score: 0.5 - out.length * 0.01, source: 'keyword' });
    }
  }

  const kwIds = new Set(keywordResults.map((r) => r._id));
  const vecIds = new Set(vectorResults.map((r) => r._id));
  for (const item of out) {
    if (kwIds.has(item._id) && vecIds.has(item._id)) {
      item.source = 'both';
    }
  }

  return out.slice(0, limit);
};

// ══════════════════════════════════════════════════════════════
// searchWithCollection — 完整模擬 lawSearch.ts 的搜尋邏輯
// ══════════════════════════════════════════════════════════════

interface SearchOpts {
  limit?: number;
  apiKey?: string;
  lawName?: string;
}

interface SearchOutput {
  results: SearchResult[];
  strategy: string;
  time: number;
}

const searchWithCollection = async (
  coll: Collection,
  query: string,
  opts: SearchOpts = {},
): Promise<SearchOutput> => {
  const { limit = 5, apiKey, lawName } = opts;
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  if (!query.trim()) return { results: [], strategy: 'empty', time: 0 };

  const articleMatch = query.match(ARTICLE_REGEX);
  const lawConceptMatch = !articleMatch ? query.match(LAW_CONCEPT_REGEX) : null;
  const start = Date.now();

  let artResolvedName: string | undefined;
  let artRawArticle: string | undefined;
  let artNormalized: string | undefined;

  if (articleMatch) {
    artResolvedName = resolveAlias(articleMatch[1].trim());
    artRawArticle = articleMatch[2].trim();
    artNormalized = normalizeArticleNo(artRawArticle);
  }

  // ── Strategy 0: Direct _id Lookup ──
  if (articleMatch && artResolvedName && artNormalized) {
    const articleId = buildArticleId(artResolvedName, artNormalized);
    if (articleId) {
      const doc = (await coll.findOne({ _id: articleId } as Record<string, unknown>)) as {
        _id: string;
        law_name: string;
        article_no: string;
      } | null;
      if (doc) {
        return {
          results: [
            {
              _id: doc._id,
              law_name: doc.law_name,
              article_no: doc.article_no,
              score: 1,
              source: 'keyword',
            },
          ],
          strategy: 'S0_id_lookup',
          time: Date.now() - start,
        };
      }
    }
  }

  // ── Strategy 1: Regex fallback ──
  if (articleMatch && artResolvedName && artRawArticle) {
    const numMatch = artRawArticle.match(/第\s*(\d+)\s*(條.*)/);
    if (numMatch) {
      const articleNum = numMatch[1];
      const suffix = numMatch[2].replace(/條|\s+/g, '');
      const articleRegex = suffix
        ? new RegExp(`第\\s*${articleNum}[-\\s]*${suffix.replace(/之/g, '[-之]\\s*')}\\s*條`)
        : new RegExp(`第\\s*${articleNum}\\s*條(?!\\s*之)(?!.*-)`);
      const directResults = (await coll
        .find({
          $or: [{ law_name: artResolvedName }, { aliases: { $regex: artResolvedName } }],
          article_no: { $regex: articleRegex },
        })
        .limit(safeLimit)
        .toArray()) as unknown as SearchResult[];
      if (directResults.length > 0) {
        return {
          results: directResults.map((r) => ({
            _id: r._id,
            law_name: r.law_name,
            article_no: r.article_no,
            score: 1,
            source: 'keyword',
          })),
          strategy: 'S1_regex',
          time: Date.now() - start,
        };
      }
    }
  }

  // ── Helper: run Atlas Search keyword query ──
  const runAtlasSearch = async (c: Record<string, unknown>): Promise<SearchResult[]> =>
    coll
      .aggregate([
        { $search: { index: 'law_search', compound: c } },
        { $limit: safeLimit },
        {
          $project: {
            _id: 1,
            pcode: 1,
            law_name: 1,
            article_no: 1,
            content: 1,
            chapter: 1,
            score: { $meta: 'searchScore' },
          },
        },
      ])
      .toArray() as unknown as Promise<SearchResult[]>;

  // ── S2: Article search via Atlas ──
  if (articleMatch && artResolvedName && artNormalized) {
    const compound: Record<string, unknown> = {
      ...buildLawClause(artResolvedName),
      should: [{ phrase: { query: artNormalized, path: 'article_no' } }],
    };
    const results = await runAtlasSearch(compound);
    return {
      results: results.map((r) => ({
        _id: r._id,
        law_name: r.law_name,
        article_no: r.article_no,
        chapter: r.chapter,
        score: r.score,
        source: 'keyword',
        contentPreview: r.content?.substring(0, 80),
      })),
      strategy: 'S2_atlas_article_atlas',
      time: Date.now() - start,
    };
  }

  // ── Concept search: unified hybrid (keyword + vector → vector-first merge) ──

  let resolvedLawName: string | undefined;
  let keywordConcept: string;

  if (lawName) {
    resolvedLawName = resolveAlias(lawName);
    keywordConcept = query;
  } else if (lawConceptMatch) {
    resolvedLawName = resolveAlias(lawConceptMatch[1]);
    keywordConcept = lawConceptMatch[2];
  } else {
    const extracted = !articleMatch ? tryExtractLawName(query) : null;
    if (extracted) {
      resolvedLawName = resolveAlias(extracted.lawName);
      keywordConcept = extracted.concept;
    } else {
      const rw = tryRewriteQuery(query);
      if (rw) {
        resolvedLawName = resolveAlias(rw.lawName);
        keywordConcept = rw.concept;
      } else {
        resolvedLawName = undefined;
        keywordConcept = query;
      }
    }
  }

  const pcode = resolvedLawName ? PCODE_MAP[resolvedLawName] : undefined;

  const buildConceptKeywordCompound = (): Record<string, unknown> => {
    if (resolvedLawName) {
      return {
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
          { text: { query: keywordConcept, path: 'category' } },
        ],
        minimumShouldMatch: 1,
      };
    }
    return {
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
        { text: { query: keywordConcept, path: 'content' } },
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
  };

  let strategyType = 'keyword';

  if (apiKey) {
    try {
      const queryVec = await embedQuery(query, apiKey);
      const [kwResults, vecResults] = await Promise.all([
        runAtlasSearch(buildConceptKeywordCompound()),
        filteredVectorSearch(coll, queryVec, safeLimit, { pcode }),
      ]);
      const merged = vectorFirstMerge(kwResults, vecResults, safeLimit);
      if (merged.length > 0) {
        const queryType = resolvedLawName ? 'law_concept' : 'pure_concept';
        return {
          results: merged.map((r) => ({
            _id: r._id,
            law_name: r.law_name,
            article_no: r.article_no,
            chapter: r.chapter,
            score: r.score,
            source: r.source,
            contentPreview: r.content?.substring(0, 80),
          })),
          strategy: `S2_hybrid_${queryType}`,
          time: Date.now() - start,
        };
      }
      strategyType = 'keyword_fallback';
    } catch (err) {
      console.warn(`        [hybrid failed: ${(err as Error).message}]`);
      strategyType = 'keyword_fallback';
    }
  }

  const kwResults = await runAtlasSearch(buildConceptKeywordCompound());
  const queryType = resolvedLawName ? 'law_concept' : 'pure_concept';
  return {
    results: kwResults.map((r) => ({
      _id: r._id,
      law_name: r.law_name,
      article_no: r.article_no,
      chapter: r.chapter,
      score: r.score,
      source: 'keyword',
      contentPreview: r.content?.substring(0, 80),
    })),
    strategy: `S2_${strategyType}_${queryType}`,
    time: Date.now() - start,
  };
};

// ══════════════════════════════════════════════════════════════
// 測試案例
// ══════════════════════════════════════════════════════════════

interface TestCase {
  query: string;
  expect: string;
  expectArticle?: string;
  mustContainLaw?: string;
  lawName?: string;
  category: string;
  desc: string;
}

const TEST_CASES: TestCase[] = [
  // ── A. 具體條號（應走 Strategy 0）──
  {
    query: '民法第184條',
    expect: 'S0',
    expectArticle: '第 184 條',
    category: 'A',
    desc: '基本條號',
  },
  {
    query: '民法第191條之2',
    expect: 'S0',
    expectArticle: '第 191-2 條',
    category: 'A',
    desc: '條之X格式',
  },
  {
    query: '民法第195條',
    expect: 'S0',
    expectArticle: '第 195 條',
    category: 'A',
    desc: '慰撫金條文',
  },
  {
    query: '民法第217條',
    expect: 'S0',
    expectArticle: '第 217 條',
    category: 'A',
    desc: '與有過失',
  },
  {
    query: '民法第213條',
    expect: 'S0',
    expectArticle: '第 213 條',
    category: 'A',
    desc: '回復原狀',
  },
  {
    query: '民法第216條',
    expect: 'S0',
    expectArticle: '第 216 條',
    category: 'A',
    desc: '損害賠償範圍',
  },
  {
    query: '民法第193條',
    expect: 'S0',
    expectArticle: '第 193 條',
    category: 'A',
    desc: '身體健康損害',
  },
  {
    query: '民法第196條',
    expect: 'S0',
    expectArticle: '第 196 條',
    category: 'A',
    desc: '物之毀損',
  },
  {
    query: '刑法第284條',
    expect: 'S0',
    expectArticle: '第 284 條',
    category: 'A',
    desc: '過失傷害',
  },
  {
    query: '刑事訴訟法第487條',
    expect: 'S0',
    expectArticle: '第 487 條',
    category: 'A',
    desc: '附帶民訴',
  },
  {
    query: '道路交通管理處罰條例第61條',
    expect: 'S0',
    expectArticle: '第 61 條',
    category: 'A',
    desc: '道交條例',
  },
  {
    query: '勞動基準法第59條',
    expect: 'S0',
    expectArticle: '第 59 條',
    category: 'A',
    desc: '職災補償',
  },
  {
    query: '消費者保護法第7條',
    expect: 'S0',
    expectArticle: '第 7 條',
    category: 'A',
    desc: '商品責任',
  },
  {
    query: '醫療法第82條',
    expect: 'S0',
    expectArticle: '第 82 條',
    category: 'A',
    desc: '醫療過失',
  },

  // ── B. 縮寫條號（ALIAS_MAP → Strategy 0）──
  {
    query: '消保法第7條',
    expect: 'S0',
    expectArticle: '第 7 條',
    category: 'B',
    desc: '縮寫消保法',
  },
  {
    query: '勞基法第59條',
    expect: 'S0',
    expectArticle: '第 59 條',
    category: 'B',
    desc: '縮寫勞基法',
  },
  {
    query: '道交條例第61條',
    expect: 'S0',
    expectArticle: '第 61 條',
    category: 'B',
    desc: '縮寫道交條例',
  },
  {
    query: '國賠法第2條',
    expect: 'S0',
    expectArticle: '第 2 條',
    category: 'B',
    desc: '縮寫國賠法',
  },
  {
    query: '個資法第29條',
    expect: 'S0',
    expectArticle: '第 29 條',
    category: 'B',
    desc: '縮寫個資法',
  },
  {
    query: '民訴法第277條',
    expect: 'S0',
    expectArticle: '第 277 條',
    category: 'B',
    desc: '縮寫民訴法',
  },

  // ── C. 法規+概念（Atlas Search, pcode filter）──
  {
    query: '民法 侵權行為',
    expect: 'S2',
    category: 'C',
    desc: '侵權核心概念',
    mustContainLaw: '民法',
  },
  { query: '民法 損害賠償', expect: 'S2', category: 'C', desc: '損害賠償', mustContainLaw: '民法' },
  { query: '民法 慰撫金', expect: 'S2', category: 'C', desc: '慰撫金', mustContainLaw: '民法' },
  {
    query: '民法 勞動能力',
    expect: 'S2',
    category: 'C',
    desc: '勞動能力減損',
    mustContainLaw: '民法',
  },
  { query: '民法 與有過失', expect: 'S2', category: 'C', desc: '與有過失', mustContainLaw: '民法' },
  { query: '民法 毀損', expect: 'S2', category: 'C', desc: '物之毀損', mustContainLaw: '民法' },
  { query: '民法 回復原狀', expect: 'S2', category: 'C', desc: '回復原狀', mustContainLaw: '民法' },
  {
    query: '民法 不完全給付',
    expect: 'S2',
    category: 'C',
    desc: '不完全給付',
    mustContainLaw: '民法',
  },
  { query: '民法 瑕疵擔保', expect: 'S2', category: 'C', desc: '瑕疵擔保', mustContainLaw: '民法' },
  { query: '民法 契約解除', expect: 'S2', category: 'C', desc: '契約解除', mustContainLaw: '民法' },
  { query: '民法 不當得利', expect: 'S2', category: 'C', desc: '不當得利', mustContainLaw: '民法' },
  { query: '民法 連帶賠償', expect: 'S2', category: 'C', desc: '連帶賠償', mustContainLaw: '民法' },
  {
    query: '民法 動力車輛',
    expect: 'S2',
    category: 'C',
    desc: '動力車輛責任',
    mustContainLaw: '民法',
  },
  { query: '民法 時效', expect: 'S2', category: 'C', desc: '消滅時效', mustContainLaw: '民法' },
  { query: '民法 代理', expect: 'S2', category: 'C', desc: '代理', mustContainLaw: '民法' },
  {
    query: '勞動基準法 職業災害',
    expect: 'S2',
    category: 'C',
    desc: '勞基法職災',
    mustContainLaw: '勞動基準法',
  },
  {
    query: '勞動基準法 資遣',
    expect: 'S2',
    category: 'C',
    desc: '勞基法資遣',
    mustContainLaw: '勞動基準法',
  },
  {
    query: '勞動事件法 舉證',
    expect: 'S2',
    category: 'C',
    desc: '勞事法舉證',
    mustContainLaw: '勞動事件法',
  },
  {
    query: '民事訴訟法 舉證',
    expect: 'S2',
    category: 'C',
    desc: '舉證責任',
    mustContainLaw: '民事訴訟法',
  },
  {
    query: '刑法 過失傷害',
    expect: 'S2',
    category: 'C',
    desc: '過失傷害',
    mustContainLaw: '中華民國刑法',
  },
  { query: '刑法 詐欺', expect: 'S2', category: 'C', desc: '詐欺', mustContainLaw: '中華民國刑法' },
  {
    query: '消費者保護法 定型化契約',
    expect: 'S2',
    category: 'C',
    desc: '消保定型化契約',
    mustContainLaw: '消費者保護法',
  },
  {
    query: '個人資料保護法 損害賠償',
    expect: 'S2',
    category: 'C',
    desc: '個資法賠償',
    mustContainLaw: '個人資料保護法',
  },

  // ── D. 純概念（無法規名稱）──
  { query: '侵權行為', expect: 'S2', category: 'D', desc: '純概念-侵權' },
  { query: '損害賠償', expect: 'S2', category: 'D', desc: '純概念-損害賠償' },
  { query: '善意取得', expect: 'S2', category: 'D', desc: '純概念-善意取得' },
  {
    query: '竊盜',
    expect: 'S2',
    category: 'D',
    desc: '純概念-竊盜',
    mustContainLaw: '中華民國刑法',
  },
  { query: '離婚', expect: 'S2', category: 'D', desc: '純概念-離婚', mustContainLaw: '民法' },
  { query: '租賃', expect: 'S2', category: 'D', desc: '純概念-租賃', mustContainLaw: '民法' },
  {
    query: '支付命令',
    expect: 'S2',
    category: 'D',
    desc: '純概念-支付命令',
    mustContainLaw: '民事訴訟法',
  },
  { query: '特休', expect: 'S2', category: 'D', desc: '純概念-特休', mustContainLaw: '勞動基準法' },
  {
    query: '漏水',
    expect: 'S2',
    category: 'D',
    desc: '純概念-漏水',
    mustContainLaw: '公寓大廈管理條例',
  },

  // ── E. 邊界情況 ──
  {
    query: '民法總則施行法第1條',
    expect: 'S0',
    expectArticle: '第 1 條',
    category: 'E',
    desc: '施行法',
  },
  {
    query: '公寓大廈管理條例第10條',
    expect: 'S0',
    expectArticle: '第 10 條',
    category: 'E',
    desc: '公大條例',
  },
  { query: '票據法第14條', expect: 'S0', expectArticle: '第 14 條', category: 'E', desc: '票據法' },
  {
    query: '民法第483條之1',
    expect: 'S0',
    expectArticle: '第 483-1 條',
    category: 'E',
    desc: '條之1格式',
  },
  {
    query: '民法第487條之1',
    expect: 'S0',
    expectArticle: '第 487-1 條',
    category: 'E',
    desc: '條之1格式2',
  },
  { query: '民法 物之瑕疵', expect: 'S2', category: 'E', desc: '物之瑕疵', mustContainLaw: '民法' },

  // ── F. Hybrid tests (keyword alone may miss, hybrid should succeed) ──
  {
    query: '民法 精神慰撫金',
    expect: 'S2',
    category: 'F',
    desc: '法條用慰撫金不用精神慰撫金',
    mustContainLaw: '民法',
  },
  {
    query: '民法 不能工作損失',
    expect: 'S2',
    category: 'F',
    desc: '法條用勞動能力不用不能工作',
    mustContainLaw: '民法',
  },
  {
    query: '勞基法 公司裁員',
    expect: 'S2',
    category: 'F',
    desc: '法條用終止契約不用裁員',
    mustContainLaw: '勞動基準法',
  },
  {
    query: '勞基法 加班費',
    expect: 'S2',
    category: 'F',
    desc: '法條用延長工時不用加班費',
    mustContainLaw: '勞動基準法',
  },

  // ── G. Vector/oral query tests ──
  {
    query: '車禍受傷可以跟對方求償嗎',
    expect: 'S2',
    category: 'G',
    desc: '口語車禍賠償（強制汽車責任保險法或民法皆合理）',
  },
  { query: '房東不退押金怎麼辦', expect: 'S2', category: 'G', desc: '口語租屋押金' },
  {
    query: '公司欠薪水怎麼辦',
    expect: 'S2',
    category: 'G',
    desc: '口語欠薪',
    mustContainLaw: '勞動基準法',
  },
  {
    query: '網路上被人罵可以告嗎',
    expect: 'S2',
    category: 'G',
    desc: '口語公然侮辱',
    mustContainLaw: '中華民國刑法',
  },
  {
    query: '離婚後小孩監護權歸誰',
    expect: 'S2',
    category: 'G',
    desc: '口語監護權',
    mustContainLaw: '民法',
  },
  { query: '鄰居漏水不處理', expect: 'S2', category: 'G', desc: '口語漏水糾紛' },
  {
    query: '被騙錢怎麼辦',
    expect: 'S2',
    category: 'G',
    desc: '口語被騙',
    mustContainLaw: '中華民國刑法',
  },
  {
    query: '東西被偷了',
    expect: 'S2',
    category: 'G',
    desc: '口語被偷',
    mustContainLaw: '中華民國刑法',
  },
  {
    query: '欠錢不還怎麼辦',
    expect: 'S2',
    category: 'G',
    desc: '口語欠錢不還',
    mustContainLaw: '民法',
  },
  {
    query: '被開除可以要求賠償嗎',
    expect: 'S2',
    category: 'G',
    desc: '口語被開除',
    mustContainLaw: '勞動基準法',
  },

  // ── H. Cross-law concept tests ──
  {
    query: '損害賠償',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳民法非冷門法規',
    mustContainLaw: '民法',
  },
  {
    query: '過失傷害',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳刑法',
    mustContainLaw: '中華民國刑法',
  },
  {
    query: '定型化契約',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳消保法',
    mustContainLaw: '消費者保護法',
  },
  {
    query: '職業災害',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳勞基法',
    mustContainLaw: '勞動基準法',
  },
  {
    query: '假扣押',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳民訴法',
    mustContainLaw: '民事訴訟法',
  },
  {
    query: '強制執行',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳強執法',
    mustContainLaw: '強制執行法',
  },
  {
    query: '酒駕',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳刑法',
    mustContainLaw: '中華民國刑法',
  },
  {
    query: '肇事逃逸',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳刑法',
    mustContainLaw: '中華民國刑法',
  },
  {
    query: '育嬰假',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳性平法',
    mustContainLaw: '性別平等工作法',
  },
  {
    query: '監護權',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳民法',
    mustContainLaw: '民法',
  },
  {
    query: '網購退貨',
    expect: 'S2',
    category: 'H',
    desc: '純概念應回傳消保法',
    mustContainLaw: '消費者保護法',
  },

  // ── I. law_name filter tests ──
  {
    query: '漏水',
    lawName: '民法',
    expect: 'S2',
    category: 'I',
    desc: 'law_name過濾漏水',
    mustContainLaw: '民法',
  },
  {
    query: '加班費',
    lawName: '勞動基準法',
    expect: 'S2',
    category: 'I',
    desc: 'law_name過濾加班',
    mustContainLaw: '勞動基準法',
  },
  {
    query: '舉證',
    lawName: '民事訴訟法',
    expect: 'S2',
    category: 'I',
    desc: 'law_name過濾舉證',
    mustContainLaw: '民事訴訟法',
  },
  {
    query: '商品瑕疵',
    lawName: '消費者保護法',
    expect: 'S2',
    category: 'I',
    desc: 'law_name過濾消保',
    mustContainLaw: '消費者保護法',
  },
];

// ══════════════════════════════════════════════════════════════
// 執行測試
// ══════════════════════════════════════════════════════════════

const categoryNames: Record<string, string> = {
  A: 'A. 具體條號（Strategy 0）',
  B: 'B. 縮寫條號（ALIAS_MAP → Strategy 0）',
  C: 'C. 法規+概念（Atlas Search）',
  D: 'D. 純概念（無法規名稱）',
  E: 'E. 邊界情況',
  F: 'F. Hybrid tests（keyword可能miss）',
  G: 'G. Vector/口語查詢',
  H: 'H. 跨法規純概念',
  I: 'I. law_name 過濾',
};

const main = async () => {
  const client = new MongoClient(MONGO_URL!, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const coll = client.db('lawdb').collection('articles');
    console.log(`Connected to MongoDB (hybrid: ${MONGO_API_KEY ? 'enabled' : 'disabled'})\n`);

    const results: Array<TestCase & SearchOutput & { ok: boolean | null }> = [];
    let passCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let totalTime = 0;
    let currentCategory = '';

    for (const tc of TEST_CASES) {
      if (tc.category !== currentCategory) {
        currentCategory = tc.category;
        console.log(`\n── ${categoryNames[tc.category] || tc.category} ──\n`);
      }

      const needsVector = ['F', 'G'].includes(tc.category);
      if (needsVector && !MONGO_API_KEY) {
        skipCount++;
        console.log(`\x1b[33m SKIP \x1b[0m ${tc.desc} (no MONGO_API_KEY)`);
        console.log('');
        results.push({ ...tc, ok: null, strategy: 'skipped', time: 0, results: [] });
        continue;
      }

      const res = await searchWithCollection(coll, tc.query, {
        limit: 5,
        apiKey: MONGO_API_KEY,
        lawName: tc.lawName,
      });
      totalTime += res.time;

      const strategyOk = res.strategy.startsWith(tc.expect);
      const articleOk = !tc.expectArticle || res.results[0]?.article_no === tc.expectArticle;
      const hasResults = res.results.length > 0;
      const lawOk =
        !tc.mustContainLaw ||
        res.results.some(
          (r) => r.law_name === tc.mustContainLaw || r.law_name?.includes(tc.mustContainLaw!),
        );
      const ok = strategyOk && articleOk && hasResults && lawOk;

      if (ok) passCount++;
      else failCount++;

      const status = ok ? '\x1b[32m PASS \x1b[0m' : '\x1b[31m FAIL \x1b[0m';
      const firstResult = res.results[0];
      const resultStr = firstResult
        ? `${firstResult.law_name} ${firstResult.article_no} [${firstResult.source}] (score:${firstResult.score?.toFixed?.(4) ?? firstResult.score})`
        : '(no results)';

      const queryDisplay = tc.lawName ? `"${tc.query}" (law_name: ${tc.lawName})` : `"${tc.query}"`;

      console.log(`${status} [${String(res.time).padStart(4)}ms] ${tc.desc}`);
      console.log(`        ${queryDisplay} -> ${res.strategy} | ${res.results.length} results`);
      console.log(`        Top: ${resultStr}`);

      if (!strategyOk)
        console.log(`        Strategy mismatch: got ${res.strategy}, expected ${tc.expect}`);
      if (!articleOk)
        console.log(
          `        Article mismatch: got ${firstResult?.article_no}, expected ${tc.expectArticle}`,
        );
      if (!hasResults) console.log('        No results returned');
      if (!lawOk)
        console.log(
          `        Wrong law: expected ${tc.mustContainLaw}, got: ${res.results.map((r) => r.law_name).join(', ')}`,
        );

      if (tc.expect === 'S2' && res.results.length > 1) {
        const top = res.results
          .slice(0, 3)
          .map((r) => `${r.law_name} ${r.article_no} [${r.source}]`)
          .join(', ');
        console.log(`        Top 3: ${top}`);
      }
      console.log('');

      results.push({ ...tc, ...res, ok });
    }

    // ── Summary ──
    const tested = TEST_CASES.length - skipCount;
    console.log('='.repeat(60));
    console.log(
      `Total: ${TEST_CASES.length} | Tested: ${tested} | Pass: ${passCount} | Fail: ${failCount} | Skip: ${skipCount} | Avg: ${tested > 0 ? (totalTime / tested).toFixed(0) : 0}ms\n`,
    );

    // Strategy breakdown
    const byStrategy: Record<string, { count: number; totalTime: number; failures: string[] }> = {};
    for (const r of results) {
      if (r.ok === null) continue;
      const s = r.strategy;
      if (!byStrategy[s]) byStrategy[s] = { count: 0, totalTime: 0, failures: [] };
      byStrategy[s].count++;
      byStrategy[s].totalTime += r.time;
      if (!r.ok) byStrategy[s].failures.push(r.query);
    }
    console.log('By Strategy:');
    for (const [s, data] of Object.entries(byStrategy)) {
      const avg = (data.totalTime / data.count).toFixed(0);
      const failStr = data.failures.length ? ` | FAILURES: ${data.failures.join(', ')}` : '';
      console.log(`  ${s}: ${data.count} queries, avg ${avg}ms${failStr}`);
    }

    // Category breakdown
    console.log('\nBy Category:');
    const byCategory: Record<string, { pass: number; fail: number; skip: number }> = {};
    for (const r of results) {
      const cat = r.category || '?';
      if (!byCategory[cat]) byCategory[cat] = { pass: 0, fail: 0, skip: 0 };
      if (r.ok === null) byCategory[cat].skip++;
      else if (r.ok) byCategory[cat].pass++;
      else byCategory[cat].fail++;
    }
    for (const [cat, data] of Object.entries(byCategory)) {
      const total = data.pass + data.fail + data.skip;
      const failStr = data.fail > 0 ? ` \x1b[31m${data.fail} FAIL\x1b[0m` : '';
      const skipStr = data.skip > 0 ? ` \x1b[33m${data.skip} SKIP\x1b[0m` : '';
      console.log(
        `  ${cat}: ${total} tests | \x1b[32m${data.pass} PASS\x1b[0m${failStr}${skipStr}`,
      );
    }

    process.exit(failCount > 0 ? 1 : 0);
  } finally {
    await client.close();
  }
};

main().catch((err) => {
  console.error('Test runner error:', (err as Error).message);
  process.exit(1);
});
