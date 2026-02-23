/**
 * Law Search 綜合測試
 *
 * 驗證 src/server/lib/lawSearch.ts 所有搜尋策略的正確性與效能。
 * 模擬 searchWithCollection 的完整邏輯，直接連 MongoDB Atlas 測試。
 *
 * 使用方式: node scripts/law-search-test/search-test.mjs
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── 讀取 MONGO_URL ──
const loadMongoUrl = () => {
  try {
    const devVars = readFileSync(resolve('dist/lexdraft/.dev.vars'), 'utf-8');
    const match = devVars.match(/MONGO_URL\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {}
  // fallback: 環境變數
  if (process.env.MONGO_URL) return process.env.MONGO_URL;
  console.error(
    'Error: MONGO_URL not found. Place it in dist/lexdraft/.dev.vars or set as env var.',
  );
  process.exit(1);
};

const MONGO_URL = loadMongoUrl();

// ══════════════════════════════════════════════════════════════
// lawConstants.ts 的複製（測試需要獨立運行，不依賴 TypeScript）
// 修改 lawConstants.ts 後，也需要同步更新這裡
// ══════════════════════════════════════════════════════════════

const PCODE_MAP = {
  民法: 'B0000001',
  民法總則施行法: 'B0000002',
  民法債編施行法: 'B0000003',
  民法親屬編施行法: 'B0000005',
  民法繼承編施行法: 'B0000006',
  民事訴訟法: 'B0010001',
  強制執行法: 'B0010004',
  非訟事件法: 'B0010008',
  家事事件法: 'B0010048',
  消費者保護法: 'J0170001',
  公寓大廈管理條例: 'D0070118',
  刑法: 'C0000001',
  刑事訴訟法: 'C0010001',
  少年事件處理法: 'C0010011',
  刑事補償法: 'C0010009',
  國民法官法: 'A0030320',
  犯罪被害人權益保障法: 'I0050005',
  公司法: 'J0080001',
  證券交易法: 'G0400001',
  票據法: 'G0380028',
  海商法: 'K0070002',
  保險法: 'G0390002',
  商業會計法: 'J0080009',
  企業併購法: 'J0080041',
  勞動基準法: 'N0030001',
  勞工保險條例: 'N0050001',
  勞動事件法: 'B0010064',
  職業安全衛生法: 'N0060001',
  職業災害勞工保護法: 'N0060041',
  就業服務法: 'N0090001',
  性別平等工作法: 'N0030014',
  勞資爭議處理法: 'N0020007',
  著作權法: 'J0070017',
  專利法: 'J0070007',
  商標法: 'J0070001',
  營業秘密法: 'J0080028',
  行政程序法: 'A0030055',
  行政訴訟法: 'A0030154',
  訴願法: 'A0030020',
  行政執行法: 'A0030023',
  行政罰法: 'A0030210',
  國家賠償法: 'I0020004',
  政府採購法: 'A0030057',
  稅捐稽徵法: 'G0340001',
  所得稅法: 'G0340003',
  加值型及非加值型營業稅法: 'G0340080',
  遺產及贈與稅法: 'G0340072',
  房屋稅條例: 'G0340102',
  土地稅法: 'G0340096',
  土地法: 'D0060001',
  土地登記規則: 'D0060003',
  耕地三七五減租條例: 'D0060008',
  平均地權條例: 'D0060009',
  都市計畫法: 'D0070001',
  建築法: 'D0070109',
  區域計畫法: 'D0070030',
  道路交通管理處罰條例: 'K0040012',
  道路交通安全規則: 'K0040013',
  個人資料保護法: 'I0050021',
  電子簽章法: 'J0080037',
  銀行法: 'G0380001',
  金融消費者保護法: 'G0380226',
  信託法: 'I0020024',
  洗錢防制法: 'G0380131',
  醫療法: 'L0020021',
  藥事法: 'L0030001',
  全民健康保險法: 'L0060001',
  環境基本法: 'O0100001',
  廢棄物清理法: 'O0050001',
  水污染防治法: 'O0040001',
  空氣污染防制法: 'O0020001',
  社會秩序維護法: 'D0080067',
  通訊保障及監察法: 'K0060044',
  仲裁法: 'I0020001',
  法律扶助法: 'A0030157',
  鄉鎮市調解條例: 'I0020003',
  公職人員選舉罷免法: 'D0020010',
  憲法訴訟法: 'A0030159',
};

const ALIAS_MAP = {
  民訴法: '民事訴訟法',
  民訴: '民事訴訟法',
  強執法: '強制執行法',
  家事法: '家事事件法',
  消保法: '消費者保護法',
  公大條例: '公寓大廈管理條例',
  中華民國刑法: '刑法',
  刑訴法: '刑事訴訟法',
  刑訴: '刑事訴訟法',
  證交法: '證券交易法',
  勞基法: '勞動基準法',
  勞保條例: '勞工保險條例',
  勞事法: '勞動事件法',
  職安法: '職業安全衛生法',
  性平法: '性別平等工作法',
  性工法: '性別平等工作法',
  勞爭法: '勞資爭議處理法',
  著作權: '著作權法',
  營秘法: '營業秘密法',
  行程法: '行政程序法',
  行政訴訟: '行政訴訟法',
  國賠法: '國家賠償法',
  行罰法: '行政罰法',
  政採法: '政府採購法',
  稅捐法: '稅捐稽徵法',
  所得稅: '所得稅法',
  營業稅: '加值型及非加值型營業稅法',
  營業稅法: '加值型及非加值型營業稅法',
  遺贈稅法: '遺產及贈與稅法',
  道交條例: '道路交通管理處罰條例',
  道交處罰條例: '道路交通管理處罰條例',
  道交管理條例: '道路交通管理處罰條例',
  道安規則: '道路交通安全規則',
  交通安全規則: '道路交通安全規則',
  個資法: '個人資料保護法',
  金保法: '金融消費者保護法',
  洗防法: '洗錢防制法',
  健保法: '全民健康保險法',
  仲裁: '仲裁法',
  都計法: '都市計畫法',
};

// ── Utility functions (from lawConstants.ts) ──

const resolveAlias = (name) => ALIAS_MAP[name] || name;

const normalizeArticleNo = (raw) => {
  let s = raw.trim();
  if (s.startsWith('§')) s = s.slice(1).trim();
  if (/^\d+$/.test(s)) return `第 ${s} 條`;
  const fullMatch = s.match(/^第\s*(\d+)\s*條\s*之\s*(\d+)$/);
  if (fullMatch) return `第 ${fullMatch[1]}-${fullMatch[2]} 條`;
  const simpleMatch = s.match(/^第\s*(\d+)\s*條$/);
  if (simpleMatch) return `第 ${simpleMatch[1]} 條`;
  return s;
};

const extractArticleNum = (articleNo) => {
  const m = articleNo.match(/第\s*(\d+(?:-\d+)?)\s*條/);
  return m ? m[1] : null;
};

const buildArticleId = (lawName, articleNo) => {
  const pcode = PCODE_MAP[lawName];
  if (!pcode) return null;
  const num = extractArticleNum(articleNo);
  if (!num) return null;
  return `${pcode}-${num}`;
};

/** 遞迴移除物件中所有 `synonyms` 欄位（用於 fallback 重搜） */
const stripSynonyms = (obj) => {
  if (Array.isArray(obj)) return obj.map(stripSynonyms);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'synonyms') continue;
      out[k] = stripSynonyms(v);
    }
    return out;
  }
  return obj;
};

// ── Regex patterns (from lawSearch.ts) ──

const ARTICLE_REGEX = /^(.+?)\s*(第\s*\S+?\s*條.*)$/;
const LAW_CONCEPT_REGEX = /^([\u4e00-\u9fff]+(?:法|規則|條例|辦法|細則))\s+(.+)$/;

// ── buildLawClause (from lawSearch.ts) ──

const buildLawClause = (resolvedName) => {
  const pcode = PCODE_MAP[resolvedName];
  if (pcode) {
    return { filter: [{ text: { query: pcode, path: 'pcode' } }] };
  }
  return {
    must: [
      { text: { query: resolvedName, path: ['law_name', 'aliases'], synonyms: 'law_synonyms' } },
    ],
  };
};

// ══════════════════════════════════════════════════════════════
// searchWithCollection — 完整模擬 lawSearch.ts 的搜尋邏輯
// ══════════════════════════════════════════════════════════════

const searchWithCollection = async (coll, query, opts = {}) => {
  const { limit = 5 } = opts;
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  if (!query.trim()) return { results: [], strategy: 'empty', time: 0 };

  const articleMatch = query.match(ARTICLE_REGEX);
  const lawConceptMatch = !articleMatch ? query.match(LAW_CONCEPT_REGEX) : null;
  const start = Date.now();

  // Pre-parse article match fields once (shared by S0, S1, S2)
  let artResolvedName;
  let artRawArticle;
  let artNormalized;

  if (articleMatch) {
    artResolvedName = resolveAlias(articleMatch[1].trim());
    artRawArticle = articleMatch[2].trim();
    artNormalized = normalizeArticleNo(artRawArticle);
  }

  // ── Strategy 0: Direct _id Lookup ──
  if (articleMatch && artResolvedName && artNormalized) {
    const articleId = buildArticleId(artResolvedName, artNormalized);
    if (articleId) {
      const doc = await coll.findOne({ _id: articleId });
      if (doc) {
        return {
          results: [{ _id: doc._id, law_name: doc.law_name, article_no: doc.article_no, score: 1 }],
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
      const directResults = await coll
        .find({
          $or: [{ law_name: artResolvedName }, { aliases: { $regex: artResolvedName } }],
          article_no: { $regex: articleRegex },
        })
        .limit(safeLimit)
        .toArray();
      if (directResults.length > 0) {
        return {
          results: directResults.map((r) => ({
            _id: r._id,
            law_name: r.law_name,
            article_no: r.article_no,
            score: 1,
          })),
          strategy: 'S1_regex',
          time: Date.now() - start,
        };
      }
    }
  }

  // ── Strategy 2: Atlas Search ──
  let compound;
  let queryType;

  if (articleMatch && artResolvedName && artNormalized) {
    queryType = 'article_atlas';
    compound = {
      ...buildLawClause(artResolvedName),
      should: [{ phrase: { query: artNormalized, path: 'article_no' } }],
    };
  } else if (lawConceptMatch) {
    const rawLawName = lawConceptMatch[1];
    const resolvedName = resolveAlias(rawLawName);
    const concept = lawConceptMatch[2];
    queryType = 'law_concept';
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
        { text: { query: concept, path: 'category', synonyms: 'law_synonyms' } },
      ],
      minimumShouldMatch: 1,
    };
  } else {
    queryType = 'pure_concept';
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
        { text: { query, path: 'content', synonyms: 'law_synonyms' } },
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

  const runAtlasSearch = async (c) =>
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
      .toArray();

  let results = await runAtlasSearch(compound);
  let usedFallback = false;

  // Synonym fallback: retry without synonyms if 0 results
  if (results.length === 0 && !articleMatch) {
    results = await runAtlasSearch(stripSynonyms(compound));
    usedFallback = true;
  }

  return {
    results: results.map((r) => ({
      _id: r._id,
      law_name: r.law_name,
      article_no: r.article_no,
      chapter: r.chapter,
      score: r.score,
      contentPreview: r.content?.substring(0, 80),
    })),
    strategy: `S2_atlas_${queryType}${usedFallback ? '_no_syn' : ''}`,
    time: Date.now() - start,
  };
};

// ══════════════════════════════════════════════════════════════
// 測試案例
//
// 新增案例格式：
//   query:          搜尋字串
//   expect:         預期策略前綴 ('S0' / 'S1' / 'S2')
//   expectArticle:  可選，預期 top1 的 article_no
//   mustContainLaw: 可選，結果必須包含此 law_name
//   desc:           測試描述
// ══════════════════════════════════════════════════════════════

const TEST_CASES = [
  // ── A. 具體條號（應走 Strategy 0）──
  { query: '民法第184條', expect: 'S0', expectArticle: '第 184 條', desc: '基本條號' },
  { query: '民法第191條之2', expect: 'S0', expectArticle: '第 191-2 條', desc: '條之X格式' },
  { query: '民法第195條', expect: 'S0', expectArticle: '第 195 條', desc: '慰撫金條文' },
  { query: '民法第217條', expect: 'S0', expectArticle: '第 217 條', desc: '與有過失' },
  { query: '民法第213條', expect: 'S0', expectArticle: '第 213 條', desc: '回復原狀' },
  { query: '民法第216條', expect: 'S0', expectArticle: '第 216 條', desc: '損害賠償範圍' },
  { query: '民法第193條', expect: 'S0', expectArticle: '第 193 條', desc: '身體健康損害' },
  { query: '民法第196條', expect: 'S0', expectArticle: '第 196 條', desc: '物之毀損' },
  { query: '刑法第284條', expect: 'S0', expectArticle: '第 284 條', desc: '過失傷害' },
  { query: '刑事訴訟法第487條', expect: 'S0', expectArticle: '第 487 條', desc: '附帶民訴' },
  {
    query: '道路交通管理處罰條例第61條',
    expect: 'S0',
    expectArticle: '第 61 條',
    desc: '道交條例',
  },
  { query: '勞動基準法第59條', expect: 'S0', expectArticle: '第 59 條', desc: '職災補償' },
  { query: '消費者保護法第7條', expect: 'S0', expectArticle: '第 7 條', desc: '商品責任' },
  { query: '醫療法第82條', expect: 'S0', expectArticle: '第 82 條', desc: '醫療過失' },

  // ── B. 縮寫條號（ALIAS_MAP → Strategy 0）──
  { query: '消保法第7條', expect: 'S0', expectArticle: '第 7 條', desc: '縮寫消保法' },
  { query: '勞基法第59條', expect: 'S0', expectArticle: '第 59 條', desc: '縮寫勞基法' },
  { query: '道交條例第61條', expect: 'S0', expectArticle: '第 61 條', desc: '縮寫道交條例' },
  { query: '國賠法第2條', expect: 'S0', expectArticle: '第 2 條', desc: '縮寫國賠法' },
  { query: '個資法第29條', expect: 'S0', expectArticle: '第 29 條', desc: '縮寫個資法' },
  { query: '民訴法第277條', expect: 'S0', expectArticle: '第 277 條', desc: '縮寫民訴法' },

  // ── C. 法規+概念（Atlas Search, pcode filter）──
  { query: '民法 侵權行為', expect: 'S2', desc: '侵權核心概念', mustContainLaw: '民法' },
  { query: '民法 損害賠償', expect: 'S2', desc: '損害賠償', mustContainLaw: '民法' },
  { query: '民法 慰撫金', expect: 'S2', desc: '慰撫金', mustContainLaw: '民法' },
  { query: '民法 勞動能力', expect: 'S2', desc: '勞動能力減損', mustContainLaw: '民法' },
  { query: '民法 與有過失', expect: 'S2', desc: '與有過失', mustContainLaw: '民法' },
  { query: '民法 毀損', expect: 'S2', desc: '物之毀損', mustContainLaw: '民法' },
  { query: '民法 回復原狀', expect: 'S2', desc: '回復原狀', mustContainLaw: '民法' },
  { query: '民法 不完全給付', expect: 'S2', desc: '不完全給付', mustContainLaw: '民法' },
  { query: '民法 瑕疵擔保', expect: 'S2', desc: '瑕疵擔保', mustContainLaw: '民法' },
  { query: '民法 契約解除', expect: 'S2', desc: '契約解除', mustContainLaw: '民法' },
  { query: '民法 不當得利', expect: 'S2', desc: '不當得利', mustContainLaw: '民法' },
  { query: '民法 連帶賠償', expect: 'S2', desc: '連帶賠償', mustContainLaw: '民法' },
  { query: '民法 動力車輛', expect: 'S2', desc: '動力車輛責任', mustContainLaw: '民法' },
  { query: '民法 時效', expect: 'S2', desc: '消滅時效', mustContainLaw: '民法' },
  { query: '民法 代理', expect: 'S2', desc: '代理', mustContainLaw: '民法' },
  { query: '勞動基準法 職業災害', expect: 'S2', desc: '勞基法職災', mustContainLaw: '勞動基準法' },
  { query: '勞動基準法 資遣', expect: 'S2', desc: '勞基法資遣', mustContainLaw: '勞動基準法' },
  {
    query: '勞動事件法 舉證',
    expect: 'S2',
    desc: '勞事法舉證（曾返回錯誤法規）',
    mustContainLaw: '勞動事件法',
  },
  { query: '民事訴訟法 舉證', expect: 'S2', desc: '舉證責任', mustContainLaw: '民事訴訟法' },
  { query: '刑法 過失傷害', expect: 'S2', desc: '過失傷害', mustContainLaw: '中華民國刑法' },
  { query: '刑法 詐欺', expect: 'S2', desc: '詐欺', mustContainLaw: '中華民國刑法' },
  {
    query: '消費者保護法 定型化契約',
    expect: 'S2',
    desc: '消保定型化契約',
    mustContainLaw: '消費者保護法',
  },
  {
    query: '個人資料保護法 損害賠償',
    expect: 'S2',
    desc: '個資法賠償',
    mustContainLaw: '個人資料保護法',
  },

  // ── D. 純概念（無法規名稱）──
  { query: '侵權行為', expect: 'S2', desc: '純概念-侵權' },
  { query: '損害賠償', expect: 'S2', desc: '純概念-損害賠償' },
  { query: '善意取得', expect: 'S2', desc: '純概念-善意取得' },

  // ── E. 邊界情況 ──
  { query: '民法總則施行法第1條', expect: 'S0', expectArticle: '第 1 條', desc: '施行法' },
  { query: '公寓大廈管理條例第10條', expect: 'S0', expectArticle: '第 10 條', desc: '公大條例' },
  { query: '票據法第14條', expect: 'S0', expectArticle: '第 14 條', desc: '票據法' },
  { query: '民法第483條之1', expect: 'S0', expectArticle: '第 483-1 條', desc: '條之1格式' },
  { query: '民法第487條之1', expect: 'S0', expectArticle: '第 487-1 條', desc: '條之1格式2' },
  { query: '民法 物之瑕疵', expect: 'S2', desc: '物之瑕疵', mustContainLaw: '民法' },
];

// ══════════════════════════════════════════════════════════════
// 執行測試
// ══════════════════════════════════════════════════════════════

const main = async () => {
  const client = new MongoClient(MONGO_URL, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const coll = client.db('lawdb').collection('articles');
    console.log('Connected to MongoDB\n');

    const results = [];
    let passCount = 0;
    let failCount = 0;
    let totalTime = 0;

    for (const tc of TEST_CASES) {
      const res = await searchWithCollection(coll, tc.query, { limit: 5 });
      totalTime += res.time;

      const strategyOk = res.strategy.startsWith(tc.expect);
      const articleOk = !tc.expectArticle || res.results[0]?.article_no === tc.expectArticle;
      const hasResults = res.results.length > 0;
      const lawOk =
        !tc.mustContainLaw ||
        res.results.some(
          (r) => r.law_name === tc.mustContainLaw || r.law_name?.includes(tc.mustContainLaw),
        );
      const ok = strategyOk && articleOk && hasResults && lawOk;

      if (ok) passCount++;
      else failCount++;

      const status = ok ? '\x1b[32m PASS \x1b[0m' : '\x1b[31m FAIL \x1b[0m';
      const firstResult = res.results[0];
      const resultStr = firstResult
        ? `${firstResult.law_name} ${firstResult.article_no} (score:${firstResult.score?.toFixed?.(2) ?? firstResult.score})`
        : '(no results)';

      console.log(`${status} [${String(res.time).padStart(4)}ms] ${tc.desc}`);
      console.log(
        `        "${tc.query}" -> ${res.strategy} | ${res.results.length} results | ${resultStr}`,
      );

      if (!strategyOk)
        console.log(`        Strategy mismatch: got ${res.strategy}, expected ${tc.expect}`);
      if (!articleOk)
        console.log(
          `        Article mismatch: got ${firstResult?.article_no}, expected ${tc.expectArticle}`,
        );
      if (!hasResults) console.log(`        No results returned`);
      if (!lawOk)
        console.log(
          `        Wrong law: expected ${tc.mustContainLaw}, got: ${res.results.map((r) => r.law_name).join(', ')}`,
        );

      // Show top 3 for concept searches
      if (tc.expect === 'S2' && res.results.length > 1) {
        const top = res.results
          .slice(0, 3)
          .map((r) => `${r.law_name} ${r.article_no}`)
          .join(', ');
        console.log(`        Top 3: ${top}`);
      }
      console.log('');

      results.push({ ...tc, ...res, ok });
    }

    // ── Summary ──
    console.log('='.repeat(60));
    console.log(
      `Total: ${TEST_CASES.length} | Pass: ${passCount} | Fail: ${failCount} | Avg: ${(totalTime / TEST_CASES.length).toFixed(0)}ms\n`,
    );

    // Strategy breakdown
    const byStrategy = {};
    for (const r of results) {
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

    // Exit code for CI
    process.exit(failCount > 0 ? 1 : 0);
  } finally {
    await client.close();
  }
};

main().catch((err) => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
