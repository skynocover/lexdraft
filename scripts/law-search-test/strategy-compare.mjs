/**
 * 搜尋策略比較實驗
 *
 * 對同一批查詢跑多種搜尋策略，逐一比較結果品質。
 * 重點關注：哪些查詢哪個策略能把「正確法條」排在最前面。
 *
 * 使用方式: node scripts/law-search-test/strategy-compare.mjs
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── 讀取 .dev.vars ──
const loadDevVars = () => {
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

// ── lawConstants 複製 ──
const PCODE_MAP = {
  民法: 'B0000001',
  民事訴訟法: 'B0010001',
  強制執行法: 'B0010004',
  家事事件法: 'B0010048',
  消費者保護法: 'J0170001',
  公寓大廈管理條例: 'D0070118',
  刑法: 'C0000001',
  刑事訴訟法: 'C0010001',
  勞動基準法: 'N0030001',
  勞動事件法: 'B0010064',
  國家賠償法: 'I0020004',
  醫療法: 'L0020021',
  個人資料保護法: 'I0050021',
  道路交通管理處罰條例: 'K0040012',
};

const ALIAS_MAP = {
  消保法: '消費者保護法',
  勞基法: '勞動基準法',
  民訴法: '民事訴訟法',
  刑訴法: '刑事訴訟法',
  國賠法: '國家賠償法',
  個資法: '個人資料保護法',
  中華民國刑法: '刑法',
  強執法: '強制執行法',
};

const CONCEPT_TO_LAW = {
  損害賠償: { law: '民法' },
  精神慰撫金: { law: '民法', concept: '慰撫金' },
  慰撫金: { law: '民法' },
  勞動能力減損: { law: '民法', concept: '勞動能力' },
  過失傷害: { law: '刑法' },
  過失致死: { law: '刑法' },
  侵權行為: { law: '民法' },
  假扣押: { law: '民事訴訟法' },
  強制執行: { law: '強制執行法' },
  定型化契約: { law: '消費者保護法' },
  職業災害: { law: '勞動基準法' },
  解僱: { law: '勞動基準法', concept: '終止契約' },
  加班: { law: '勞動基準法', concept: '延長工時' },
  車禍賠償: { law: '民法', concept: '損害賠償' },
  公然侮辱: { law: '刑法' },
  國家賠償: { law: '國家賠償法' },
};

const resolveAlias = (name) => ALIAS_MAP[name] || name;

const SORTED_CONCEPTS = Object.keys(CONCEPT_TO_LAW).sort((a, b) => b.length - a.length);
const tryRewriteQuery = (query) => {
  const trimmed = query.trim();
  if (CONCEPT_TO_LAW[trimmed]) {
    const e = CONCEPT_TO_LAW[trimmed];
    return { lawName: e.law, concept: e.concept || trimmed };
  }
  for (const key of SORTED_CONCEPTS) {
    if (trimmed.includes(key)) {
      const e = CONCEPT_TO_LAW[key];
      return { lawName: e.law, concept: e.concept || trimmed };
    }
  }
  return null;
};

const LAW_CONCEPT_REGEX = /^([\u4e00-\u9fff]+(?:法|規則|條例|辦法|細則))\s+(.+)$/;

const SORTED_LAW_NAMES = [
  ...new Set([...Object.keys(PCODE_MAP), ...Object.keys(ALIAS_MAP)]),
].sort((a, b) => b.length - a.length);

const tryExtractLawName = (query) => {
  const trimmed = query.trim();
  for (const name of SORTED_LAW_NAMES) {
    if (trimmed.startsWith(name) && trimmed.length > name.length) {
      const concept = trimmed.slice(name.length).trim();
      if (concept) return { lawName: name, concept };
    }
  }
  return null;
};

// ── Embedding ──
const embedQuery = async (text) => {
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
  const json = await res.json();
  return json.data[0].embedding;
};

// ── Search primitives ──

const buildLawClause = (resolvedName) => {
  const pcode = PCODE_MAP[resolvedName];
  if (pcode) return { filter: [{ text: { query: pcode, path: 'pcode' } }] };
  return { must: [{ text: { query: resolvedName, path: ['law_name', 'aliases'] } }] };
};

const keywordSearch = async (coll, concept, resolvedLawName, limit) => {
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
    .toArray();
};

const vectorSearch = async (coll, queryVector, limit, pcode) => {
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
    .toArray();
};

// ── Merge strategies ──

const rrfMerge = (kwResults, vecResults, limit, k) => {
  const scoreMap = new Map();
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

// Vector-first: if vector has good results, prefer them; fill gaps with keyword
const vectorFirstMerge = (kwResults, vecResults, limit) => {
  const seen = new Set();
  const out = [];
  // Vector results first
  for (const r of vecResults) {
    if (!seen.has(r._id)) {
      seen.add(r._id);
      out.push({ ...r, source: 'vec' });
    }
  }
  // Fill with keyword
  for (const r of kwResults) {
    if (!seen.has(r._id) && out.length < limit) {
      seen.add(r._id);
      out.push({ ...r, source: 'kw' });
    }
  }
  return out.slice(0, limit);
};

// Keyword-first: keyword results first, fill gaps with vector
const keywordFirstMerge = (kwResults, vecResults, limit) => {
  const seen = new Set();
  const out = [];
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
// 每個查詢都有人工標定的「正確答案」（expectedIds 或 expectedLaw）
const EXPERIMENTS = [
  // ── 法規+概念（有明確正確條文）──
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
  {
    query: '民法 勞動能力',
    lawName: '民法',
    expectedIds: ['B0000001-193'],
    desc: '勞動能力減損',
  },
  {
    query: '民法 與有過失',
    lawName: '民法',
    expectedIds: ['B0000001-217'],
    desc: '與有過失',
  },
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

  // ── 口語 / keyword 困難查詢 ──
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

  // ── 純概念（CONCEPT_TO_LAW 改寫）──
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

  // ── 口語查詢（無法規名稱，無 CONCEPT_TO_LAW match）──
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

  // ── law_name 參數 ──
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

/**
 * Recall@K: expectedIds 中有多少出現在 top K 結果
 * Precision: top K 結果中有多少屬於 expectedLaw
 * MRR: 第一個正確結果的倒數排名
 */
const evaluate = (results, expected) => {
  const topIds = results.slice(0, 5).map((r) => r._id);
  const topLaws = results.slice(0, 5).map((r) => r.law_name);

  let recall = 0;
  let mrr = 0;

  if (expected.expectedIds?.length) {
    const hits = expected.expectedIds.filter((id) => topIds.includes(id));
    recall = hits.length / expected.expectedIds.length;

    // MRR: find first expected ID in results
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
      (l) => l === expected.expectedLaw || l?.includes(expected.expectedLaw),
    );
    lawPrecision = topLaws.length > 0 ? correctLaw.length / topLaws.length : 0;

    // If no expectedIds, use law match for MRR
    if (!expected.expectedIds?.length && mrr === 0) {
      for (let i = 0; i < topLaws.length; i++) {
        if (
          topLaws[i] === expected.expectedLaw ||
          topLaws[i]?.includes(expected.expectedLaw)
        ) {
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
  const client = new MongoClient(MONGO_URL, {
    maxPoolSize: 3,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 15000,
  });

  try {
    await client.connect();
    const coll = client.db('lawdb').collection('articles');
    console.log('Connected. Running strategy comparison...\n');

    const LIMIT = 5;

    // Aggregate scores per strategy
    const strategyScores = {
      'keyword-only': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'vector-only': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'vector-only-filtered': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'rrf-k60': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'rrf-k10': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'keyword-first': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
      'vector-first': { recall: 0, mrr: 0, lawPrec: 0, n: 0, time: 0 },
    };

    for (const exp of EXPERIMENTS) {
      // Parse query to extract law name / concept
      let resolvedLawName;
      let keywordConcept;

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
      if (exp.expectedIds)
        console.log(`  expected: ${exp.expectedIds.join(', ')}`);
      if (exp.expectedLaw) console.log(`  expected law: ${exp.expectedLaw}`);

      // Run keyword
      const t0 = Date.now();
      const kwResults = await keywordSearch(coll, keywordConcept, resolvedLawName, LIMIT);
      const kwTime = Date.now() - t0;

      // Run vector (unfiltered)
      const t1 = Date.now();
      const queryVec = await embedQuery(exp.query);
      const vecResults = await vectorSearch(coll, queryVec, LIMIT);
      const vecTime = Date.now() - t1;

      // Run vector (filtered by pcode)
      const t2 = Date.now();
      const vecFilteredResults = pcode
        ? await vectorSearch(coll, queryVec, LIMIT, pcode)
        : vecResults;
      const vecFilteredTime = Date.now() - t2;

      // Build merges
      const rrfK60 = rrfMerge(kwResults, vecFilteredResults, LIMIT, 60);
      const rrfK10 = rrfMerge(kwResults, vecFilteredResults, LIMIT, 10);
      const kwFirst = keywordFirstMerge(kwResults, vecFilteredResults, LIMIT);
      const vecFirst = vectorFirstMerge(kwResults, vecFilteredResults, LIMIT);

      const strategies = [
        { name: 'keyword-only', results: kwResults, time: kwTime },
        { name: 'vector-only', results: vecResults, time: vecTime },
        {
          name: 'vector-only-filtered',
          results: vecFilteredResults,
          time: vecFilteredTime,
        },
        { name: 'rrf-k60', results: rrfK60, time: kwTime + vecFilteredTime },
        { name: 'rrf-k10', results: rrfK10, time: kwTime + vecFilteredTime },
        { name: 'keyword-first', results: kwFirst, time: kwTime + vecFilteredTime },
        { name: 'vector-first', results: vecFirst, time: kwTime + vecFilteredTime },
      ];

      // Evaluate and print
      for (const s of strategies) {
        const ev = evaluate(s.results, exp);
        const top3 = s.results
          .slice(0, 3)
          .map((r) => `${r.law_name} ${r.article_no}`)
          .join(' | ');
        const recallStr = exp.expectedIds?.length
          ? `recall=${ev.recall.toFixed(2)}`
          : '';
        const mrrStr = `mrr=${ev.mrr.toFixed(2)}`;
        const lawStr = exp.expectedLaw
          ? `lawPrec=${ev.lawPrecision.toFixed(2)}`
          : '';

        const highlight =
          ev.mrr >= 1.0 ? '\x1b[32m' : ev.mrr >= 0.5 ? '\x1b[33m' : '\x1b[31m';

        console.log(
          `  ${highlight}${s.name.padEnd(22)}\x1b[0m ${mrrStr} ${recallStr} ${lawStr} [${s.time}ms]`,
        );
        console.log(`    ${top3}`);

        // Accumulate
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
  console.error('Error:', err.message);
  process.exit(1);
});
