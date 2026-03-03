/**
 * 搜尋策略比較實驗
 *
 * 對同一批查詢跑多種搜尋策略，逐一比較結果品質。
 * 重點關注：哪些查詢哪個策略能把「正確法條」排在最前面。
 *
 * 使用方式: npx tsx scripts/law-search-test/strategy-compare.ts
 */
import { MongoClient, type Collection } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PCODE_MAP,
  ALIAS_MAP,
  resolveAlias,
  tryRewriteQuery,
  tryExtractLawName,
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
    return { mongoUrl: process.env.MONGO_URL, apiKey: process.env.MONGO_API_KEY };
  }
};

const { mongoUrl: MONGO_URL, apiKey: API_KEY } = loadDevVars();
if (!MONGO_URL || !API_KEY) {
  console.error('Need both MONGO_URL and MONGO_API_KEY');
  process.exit(1);
}

// ── Embedding ──
const embedQuery = async (text: string): Promise<number[]> => {
  const res = await fetch('https://ai.mongodb.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-3.5',
      input: [text],
      input_type: 'query',
      output_dimension: 512,
    }),
  });
  if (!res.ok) throw new Error(`Embedding HTTP ${res.status}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
};

// ── Search primitives ──

interface SearchResult {
  _id: string;
  law_name: string;
  article_no: string;
  content?: string;
  score: number;
  source?: string;
}

const buildLawClause = (resolvedName: string): { filter?: unknown[]; must?: unknown[] } => {
  const pcode = PCODE_MAP[resolvedName];
  if (pcode) return { filter: [{ text: { query: pcode, path: 'pcode' } }] };
  return { must: [{ text: { query: resolvedName, path: ['law_name', 'aliases'] } }] };
};

const keywordSearch = async (
  coll: Collection,
  concept: string,
  resolvedLawName: string | undefined,
  limit: number,
): Promise<SearchResult[]> => {
  const compound = resolvedLawName
    ? {
        ...buildLawClause(resolvedLawName),
        should: [
          { text: { query: concept, path: 'chapter', score: { boost: { value: 5 } } } },
          { text: { query: concept, path: 'content', score: { boost: { value: 3 } } } },
          { text: { query: concept, path: 'category' } },
        ],
        minimumShouldMatch: 1,
      }
    : {
        should: [
          {
            text: {
              query: concept,
              path: ['law_name', 'aliases'],
              score: { boost: { value: 1.5 } },
            },
          },
          { text: { query: concept, path: 'chapter', score: { boost: { value: 3 } } } },
          { text: { query: concept, path: 'content' } },
          { text: { query: concept, path: 'category', score: { boost: { value: 0.5 } } } },
        ],
        minimumShouldMatch: 1,
      };

  return coll
    .aggregate([
      { $search: { index: 'law_search', compound } },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          law_name: 1,
          article_no: 1,
          content: 1,
          score: { $meta: 'searchScore' },
        },
      },
    ])
    .toArray() as unknown as Promise<SearchResult[]>;
};

const vectorSearch = async (
  coll: Collection,
  queryVector: number[],
  limit: number,
  pcode?: string,
): Promise<SearchResult[]> => {
  const filter = pcode ? { pcode: { $eq: pcode } } : undefined;
  return coll
    .aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector,
          numCandidates: limit * 10,
          limit,
          ...(filter && { filter }),
        },
      },
      {
        $project: {
          _id: 1,
          law_name: 1,
          article_no: 1,
          content: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])
    .toArray() as unknown as Promise<SearchResult[]>;
};

// ── Merge strategies ──

const rrfMerge = (
  kwResults: SearchResult[],
  vecResults: SearchResult[],
  limit: number,
  k: number,
): SearchResult[] => {
  const scoreMap = new Map<string, { score: number; article: SearchResult; src: string[] }>();
  for (const [rank, r] of kwResults.entries()) {
    const ex = scoreMap.get(r._id);
    const s = 1 / (k + rank + 1);
    scoreMap.set(r._id, {
      score: (ex?.score || 0) + s,
      article: ex?.article || r,
      src: [...(ex?.src || []), 'kw'],
    });
  }
  for (const [rank, r] of vecResults.entries()) {
    const ex = scoreMap.get(r._id);
    const s = 1 / (k + rank + 1);
    scoreMap.set(r._id, {
      score: (ex?.score || 0) + s,
      article: ex?.article || r,
      src: [...(ex?.src || []), 'vec'],
    });
  }
  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article, src }) => ({
      ...article,
      source: src.includes('kw') && src.includes('vec') ? 'both' : src[0],
    }));
};

const vectorFirstMerge = (
  kwResults: SearchResult[],
  vecResults: SearchResult[],
  limit: number,
): SearchResult[] => {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of vecResults) {
    if (!seen.has(r._id)) {
      seen.add(r._id);
      out.push({ ...r, source: 'vec' });
    }
  }
  for (const r of kwResults) {
    if (!seen.has(r._id) && out.length < limit) {
      seen.add(r._id);
      out.push({ ...r, source: 'kw' });
    }
  }
  return out.slice(0, limit);
};

const keywordFirstMerge = (
  kwResults: SearchResult[],
  vecResults: SearchResult[],
  limit: number,
): SearchResult[] => {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of kwResults) {
    if (!seen.has(r._id)) {
      seen.add(r._id);
      out.push({ ...r, source: 'kw' });
    }
  }
  for (const r of vecResults) {
    if (!seen.has(r._id) && out.length < limit) {
      seen.add(r._id);
      out.push({ ...r, source: 'vec' });
    }
  }
  return out.slice(0, limit);
};

// ── 實驗查詢集 ──

interface Experiment {
  query: string;
  lawName?: string;
  explicitLawName?: boolean;
  expectedIds?: string[];
  expectedLaw?: string;
  desc: string;
}

const EXPERIMENTS: Experiment[] = [
  {
    query: '民法 損害賠償',
    lawName: '民法',
    expectedIds: ['B0000001-184', 'B0000001-213', 'B0000001-216'],
    desc: '損害賠償核心三條',
  },
  {
    query: '民法 侵權行為',
    lawName: '民法',
    expectedIds: ['B0000001-184', 'B0000001-185', 'B0000001-186'],
    desc: '侵權行為核心',
  },
  {
    query: '民法 慰撫金',
    lawName: '民法',
    expectedIds: ['B0000001-195', 'B0000001-194'],
    desc: '慰撫金',
  },
  { query: '民法 勞動能力', lawName: '民法', expectedIds: ['B0000001-193'], desc: '勞動能力減損' },
  { query: '民法 與有過失', lawName: '民法', expectedIds: ['B0000001-217'], desc: '與有過失' },
  {
    query: '民法 回復原狀',
    lawName: '民法',
    expectedIds: ['B0000001-213', 'B0000001-214', 'B0000001-215'],
    desc: '回復原狀',
  },
  {
    query: '勞動基準法 資遣',
    lawName: '勞動基準法',
    expectedIds: ['N0030001-11', 'N0030001-17'],
    desc: '資遣（終止契約+資遣費）',
  },
  {
    query: '民事訴訟法 舉證',
    lawName: '民事訴訟法',
    expectedIds: ['B0010001-277'],
    desc: '舉證責任分配',
  },
  {
    query: '民法 精神慰撫金',
    lawName: '民法',
    expectedIds: ['B0000001-195', 'B0000001-194'],
    desc: '精神慰撫金（法條用「慰撫金」）',
  },
  {
    query: '民法 不能工作損失',
    lawName: '民法',
    expectedIds: ['B0000001-193'],
    desc: '不能工作（法條用「勞動能力」）',
  },
  {
    query: '勞基法 加班費',
    lawName: '勞動基準法',
    expectedIds: ['N0030001-24', 'N0030001-32'],
    desc: '加班費（法條用「延長工時」）',
  },
  {
    query: '勞基法 公司裁員',
    lawName: '勞動基準法',
    expectedIds: ['N0030001-11', 'N0030001-13'],
    desc: '公司裁員（法條用「終止契約」「預告」）',
  },
  {
    query: '損害賠償',
    expectedLaw: '民法',
    expectedIds: ['B0000001-184', 'B0000001-213', 'B0000001-216'],
    desc: '純概念-損害賠償',
  },
  {
    query: '過失傷害',
    expectedLaw: '中華民國刑法',
    expectedIds: ['C0000001-284'],
    desc: '純概念-過失傷害',
  },
  {
    query: '假扣押',
    expectedLaw: '民事訴訟法',
    expectedIds: ['B0010001-522', 'B0010001-523', 'B0010001-526'],
    desc: '純概念-假扣押',
  },
  {
    query: '定型化契約',
    expectedLaw: '消費者保護法',
    expectedIds: ['J0170001-11', 'J0170001-12', 'J0170001-17'],
    desc: '純概念-定型化契約',
  },
  {
    query: '職業災害',
    expectedLaw: '勞動基準法',
    expectedIds: ['N0030001-59', 'N0030001-60'],
    desc: '純概念-職業災害',
  },
  {
    query: '車禍受傷可以跟對方求償嗎',
    expectedLaw: '民法',
    expectedIds: ['B0000001-184', 'B0000001-191-2', 'B0000001-193'],
    desc: '口語-車禍賠償',
  },
  {
    query: '公司欠薪水怎麼辦',
    expectedLaw: '勞動基準法',
    expectedIds: ['N0030001-22', 'N0030001-27'],
    desc: '口語-欠薪',
  },
  {
    query: '網路上被人罵可以告嗎',
    expectedLaw: '中華民國刑法',
    expectedIds: ['C0000001-309', 'C0000001-310'],
    desc: '口語-公然侮辱/誹謗',
  },
  {
    query: '離婚後小孩監護權歸誰',
    expectedLaw: '民法',
    expectedIds: ['B0000001-1055', 'B0000001-1055-1'],
    desc: '口語-監護權',
  },
  {
    query: '漏水',
    lawName: '民法',
    explicitLawName: true,
    expectedLaw: '民法',
    desc: 'law_name 過濾-漏水',
  },
  {
    query: '加班費',
    lawName: '勞動基準法',
    explicitLawName: true,
    expectedIds: ['N0030001-24'],
    desc: 'law_name 過濾-加班費',
  },
];

// ── 計算品質分數 ──

const evaluate = (
  results: SearchResult[],
  expected: Experiment,
): { recall: number; mrr: number; lawPrecision: number } => {
  const topIds = results.slice(0, 5).map((r) => r._id);
  const topLaws = results.slice(0, 5).map((r) => r.law_name);

  let recall = 0;
  let mrr = 0;

  if (expected.expectedIds?.length) {
    const hits = expected.expectedIds.filter((id) => topIds.includes(id));
    recall = hits.length / expected.expectedIds.length;

    for (let i = 0; i < topIds.length; i++) {
      if (expected.expectedIds.includes(topIds[i])) {
        mrr = 1 / (i + 1);
        break;
      }
    }
  }

  let lawPrecision = 0;
  if (expected.expectedLaw) {
    const correctLaw = topLaws.filter(
      (l) => l === expected.expectedLaw || l?.includes(expected.expectedLaw!),
    );
    lawPrecision = topLaws.length > 0 ? correctLaw.length / topLaws.length : 0;

    if (!expected.expectedIds?.length && mrr === 0) {
      for (let i = 0; i < topLaws.length; i++) {
        if (topLaws[i] === expected.expectedLaw || topLaws[i]?.includes(expected.expectedLaw!)) {
          mrr = 1 / (i + 1);
          break;
        }
      }
    }
  }

  return { recall, mrr, lawPrecision };
};

// ── Main ──

const main = async () => {
  const client = new MongoClient(MONGO_URL!, {
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 15000,
  });

  try {
    await client.connect();
    const coll = client.db('lawdb').collection('articles');
    console.log('Connected. Running strategy comparison...\n');

    const LIMIT = 5;

    const strategyScores: Record<
      string,
      { recall: number; mrr: number; lawPrec: number; n: number; time: number }
    > = {
      'keyword-only': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'vector-only': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'vector-only-filtered': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'rrf-k60': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'rrf-k10': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'keyword-first': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'vector-first': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
    };

    for (const exp of EXPERIMENTS) {
      let resolvedLawName: string | undefined;
      let keywordConcept: string;

      if (exp.explicitLawName && exp.lawName) {
        resolvedLawName = resolveAlias(exp.lawName);
        keywordConcept = exp.query;
      } else {
        const lawConceptMatch = exp.query.match(LAW_CONCEPT_REGEX);
        if (exp.lawName) {
          resolvedLawName = resolveAlias(exp.lawName);
          keywordConcept = lawConceptMatch ? lawConceptMatch[2] : exp.query;
        } else if (lawConceptMatch) {
          resolvedLawName = resolveAlias(lawConceptMatch[1]);
          keywordConcept = lawConceptMatch[2];
        } else {
          const extracted = tryExtractLawName(exp.query);
          if (extracted) {
            resolvedLawName = resolveAlias(extracted.lawName);
            keywordConcept = extracted.concept;
          } else {
            const rw = tryRewriteQuery(exp.query);
            if (rw) {
              resolvedLawName = resolveAlias(rw.lawName);
              keywordConcept = rw.concept;
            } else {
              resolvedLawName = undefined;
              keywordConcept = exp.query;
            }
          }
        }
      }

      const pcode = resolvedLawName ? PCODE_MAP[resolvedLawName] : undefined;

      console.log(`━━━ ${exp.desc} ━━━`);
      console.log(
        `  query="${exp.query}" → lawName=${resolvedLawName || '(none)'} concept="${keywordConcept}"`,
      );
      if (exp.expectedIds) console.log(`  expected: ${exp.expectedIds.join(', ')}`);
      if (exp.expectedLaw) console.log(`  expected law: ${exp.expectedLaw}`);

      const t0 = Date.now();
      const kwResults = await keywordSearch(coll, keywordConcept, resolvedLawName, LIMIT);
      const kwTime = Date.now() - t0;

      const t1 = Date.now();
      const queryVec = await embedQuery(exp.query);
      const vecResults = await vectorSearch(coll, queryVec, LIMIT);
      const vecTime = Date.now() - t1;

      const t2 = Date.now();
      const vecFilteredResults = pcode
        ? await vectorSearch(coll, queryVec, LIMIT, pcode)
        : vecResults;
      const vecFilteredTime = Date.now() - t2;

      const rrfK60 = rrfMerge(kwResults, vecFilteredResults, LIMIT, 60);
      const rrfK10 = rrfMerge(kwResults, vecFilteredResults, LIMIT, 10);
      const kwFirst = keywordFirstMerge(kwResults, vecFilteredResults, LIMIT);
      const vecFirst = vectorFirstMerge(kwResults, vecFilteredResults, LIMIT);

      const strategies = [
        { name: 'keyword-only', results: kwResults, time: kwTime },
        { name: 'vector-only', results: vecResults, time: vecTime },
        { name: 'vector-only-filtered', results: vecFilteredResults, time: vecFilteredTime },
        { name: 'rrf-k60', results: rrfK60, time: kwTime + vecFilteredTime },
        { name: 'rrf-k10', results: rrfK10, time: kwTime + vecFilteredTime },
        { name: 'keyword-first', results: kwFirst, time: kwTime + vecFilteredTime },
        { name: 'vector-first', results: vecFirst, time: kwTime + vecFilteredTime },
      ];

      for (const s of strategies) {
        const ev = evaluate(s.results, exp);
        const top3 = s.results
          .slice(0, 3)
          .map((r) => `${r.law_name} ${r.article_no}`)
          .join(' | ');
        const recallStr = exp.expectedIds?.length ? `recall=${ev.recall.toFixed(2)}` : '';
        const mrrStr = `mrr=${ev.mrr.toFixed(2)}`;
        const lawStr = exp.expectedLaw ? `lawPrec=${ev.lawPrecision.toFixed(2)}` : '';

        const highlight = ev.mrr >= 1.0 ? '\x1b[32m' : ev.mrr >= 0.5 ? '\x1b[33m' : '\x1b[31m';

        console.log(
          `  ${highlight}${s.name.padEnd(22)}\x1b[0m ${mrrStr} ${recallStr} ${lawStr} [${s.time}ms]`,
        );
        console.log(`    ${top3}`);

        const agg = strategyScores[s.name];
        agg.recall += ev.recall;
        agg.mrr += ev.mrr;
        agg.lawPrec += ev.lawPrecision;
        agg.n++;
        agg.time += s.time;
      }
      console.log('');
    }

    // ── Aggregate Summary ──
    console.log('═'.repeat(70));
    console.log('AGGREGATE SCORES (higher = better)\n');
    console.log(
      'Strategy'.padEnd(24) +
        'Avg MRR'.padStart(10) +
        'Avg Recall'.padStart(12) +
        'Avg LawPrec'.padStart(13) +
        'Avg Time'.padStart(10),
    );
    console.log('-'.repeat(69));

    const entries = Object.entries(strategyScores).sort(
      (a, b) => b[1].mrr / b[1].n - a[1].mrr / a[1].n,
    );
    for (const [name, agg] of entries) {
      const avgMrr = (agg.mrr / agg.n).toFixed(3);
      const avgRecall = (agg.recall / agg.n).toFixed(3);
      const avgLawPrec = (agg.lawPrec / agg.n).toFixed(3);
      const avgTime = (agg.time / agg.n).toFixed(0);
      console.log(
        name.padEnd(24) +
          avgMrr.padStart(10) +
          avgRecall.padStart(12) +
          avgLawPrec.padStart(13) +
          (avgTime + 'ms').padStart(10),
      );
    }
  } finally {
    await client.close();
  }
};

main().catch((err) => {
  console.error('Error:', (err as Error).message);
  process.exit(1);
});
