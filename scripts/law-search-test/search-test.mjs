/**
 * Law Search 綜合測試
 *
 * 驗證 src/server/lib/lawSearch.ts 所有搜尋策略的正確性與效能。
 * 模擬 searchWithCollection 的完整邏輯，直接連 MongoDB Atlas 測試。
 * 支援 keyword-only 和 hybrid (keyword+vector) 測試。
 *
 * 使用方式: node scripts/law-search-test/search-test.mjs
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

// CONCEPT_TO_LAW 改寫表（from lawConstants.ts）
const CONCEPT_TO_LAW = {
  損害賠償: { law: '民法' },
  賠償責任: { law: '民法', concept: '損害賠償' },
  回復原狀: { law: '民法' },
  過失相抵: { law: '民法' },
  與有過失: { law: '民法' },
  連帶賠償: { law: '民法' },
  連帶責任: { law: '民法' },
  違約金: { law: '民法' },
  債務不履行: { law: '民法' },
  不完全給付: { law: '民法' },
  瑕疵擔保: { law: '民法' },
  契約解除: { law: '民法' },
  不當得利: { law: '民法' },
  無因管理: { law: '民法' },
  合夥: { law: '民法' },
  保證: { law: '民法' },
  買賣: { law: '民法' },
  租賃: { law: '民法' },
  承攬: { law: '民法' },
  委任: { law: '民法' },
  借貸: { law: '民法', concept: '消費借貸' },
  贈與: { law: '民法' },
  合會: { law: '民法' },
  代位權: { law: '民法', concept: '代位' },
  撤銷權: { law: '民法', concept: '撤銷' },
  抵銷: { law: '民法' },
  連帶債務: { law: '民法', concept: '連帶' },
  遲延: { law: '民法', concept: '給付遲延' },
  定金: { law: '民法' },
  侵權行為: { law: '民法' },
  僱用人責任: { law: '民法', concept: '僱用人' },
  慰撫金: { law: '民法' },
  精神慰撫金: { law: '民法', concept: '慰撫金' },
  精神賠償: { law: '民法', concept: '慰撫金' },
  勞動能力: { law: '民法' },
  勞動能力減損: { law: '民法', concept: '勞動能力' },
  共同侵權: { law: '民法', concept: '共同不法' },
  名譽侵害: { law: '民法', concept: '名譽' },
  動力車輛: { law: '民法' },
  工作物所有人: { law: '民法', concept: '工作物' },
  善意取得: { law: '民法', concept: '善意受讓' },
  所有權: { law: '民法' },
  抵押權: { law: '民法' },
  留置權: { law: '民法' },
  離婚: { law: '民法' },
  監護權: { law: '民法', concept: '未成年子女權利義務' },
  扶養: { law: '民法' },
  繼承: { law: '民法' },
  遺囑: { law: '民法' },
  特留分: { law: '民法' },
  剩餘財產分配: { law: '民法', concept: '剩餘財產' },
  夫妻財產制: { law: '民法', concept: '夫妻財產' },
  贍養費: { law: '民法', concept: '贍養' },
  消滅時效: { law: '民法' },
  意思表示: { law: '民法' },
  過失傷害: { law: '刑法' },
  過失致死: { law: '刑法' },
  詐欺: { law: '刑法' },
  背信: { law: '刑法' },
  誹謗: { law: '刑法' },
  公然侮辱: { law: '刑法' },
  傷害: { law: '刑法' },
  竊盜: { law: '刑法' },
  侵占: { law: '刑法' },
  恐嚇: { law: '刑法' },
  偽造文書: { law: '刑法' },
  毀損: { law: '刑法', concept: '毀棄損壞' },
  妨害自由: { law: '刑法' },
  強制罪: { law: '刑法', concept: '強制' },
  妨害名譽: { law: '刑法', concept: '誹謗' },
  肇事逃逸: { law: '刑法', concept: '肇事遺棄' },
  酒駕: { law: '刑法', concept: '不能安全駕駛' },
  妨害性自主: { law: '刑法' },
  偽證: { law: '刑法' },
  教唆: { law: '刑法' },
  幫助犯: { law: '刑法', concept: '幫助' },
  緩刑: { law: '刑法' },
  累犯: { law: '刑法' },
  自首: { law: '刑法' },
  舉證責任: { law: '民事訴訟法', concept: '舉證' },
  假扣押: { law: '民事訴訟法' },
  假處分: { law: '民事訴訟法' },
  強制執行: { law: '強制執行法' },
  支付命令: { law: '民事訴訟法' },
  保全程序: { law: '民事訴訟法' },
  訴訟費用: { law: '民事訴訟法' },
  管轄: { law: '民事訴訟法' },
  上訴: { law: '民事訴訟法' },
  調解: { law: '民事訴訟法' },
  查封: { law: '強制執行法' },
  拍賣: { law: '強制執行法' },
  定型化契約: { law: '消費者保護法' },
  商品責任: { law: '消費者保護法', concept: '商品' },
  解僱: { law: '勞動基準法', concept: '終止契約' },
  資遣: { law: '勞動基準法' },
  職業災害: { law: '勞動基準法' },
  加班: { law: '勞動基準法', concept: '延長工時' },
  工作加班: { law: '勞動基準法', concept: '延長工時' },
  特休: { law: '勞動基準法', concept: '特別休假' },
  工資: { law: '勞動基準法' },
  退休金: { law: '勞動基準法', concept: '退休' },
  最低工資: { law: '勞動基準法', concept: '基本工資' },
  調職: { law: '勞動基準法', concept: '調動' },
  試用期: { law: '勞動基準法' },
  工時: { law: '勞動基準法', concept: '工作時間' },
  產假: { law: '性別平等工作法' },
  育嬰假: { law: '性別平等工作法', concept: '育嬰留職停薪' },
  性騷擾: { law: '性別平等工作法' },
  管理費: { law: '公寓大廈管理條例' },
  區分所有: { law: '公寓大廈管理條例' },
  漏水: { law: '公寓大廈管理條例' },
  個資外洩: { law: '個人資料保護法', concept: '個人資料' },
  網購退貨: { law: '消費者保護法', concept: '通訊交易' },
  鑑賞期: { law: '消費者保護法', concept: '通訊交易' },
  消費糾紛: { law: '消費者保護法', concept: '消費' },
  著作侵權: { law: '著作權法', concept: '著作權' },
  抄襲: { law: '著作權法', concept: '重製' },
  專利侵權: { law: '專利法', concept: '專利權' },
  商標侵權: { law: '商標法', concept: '商標權' },
  車禍賠償: { law: '民法', concept: '損害賠償' },
  醫療糾紛: { law: '醫療法', concept: '醫療' },
  國家賠償: { law: '國家賠償法' },
  被騙: { law: '刑法', concept: '詐欺' },
  被打: { law: '刑法', concept: '傷害' },
  被偷: { law: '刑法', concept: '竊盜' },
  欠錢不還: { law: '民法', concept: '清償' },
  合約糾紛: { law: '民法', concept: '債務不履行' },
  房屋買賣: { law: '民法', concept: '買賣' },
  租屋糾紛: { law: '民法', concept: '租賃' },
  遺產糾紛: { law: '民法', concept: '繼承' },
  交通事故: { law: '民法', concept: '損害賠償' },
  工傷: { law: '勞動基準法', concept: '職業災害' },
  被開除: { law: '勞動基準法', concept: '終止契約' },
  遣散: { law: '勞動基準法', concept: '資遣' },
  薪水: { law: '勞動基準法', concept: '工資' },
};

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

// ── Utility functions (from lawConstants.ts) ──

const resolveAlias = (name) => ALIAS_MAP[name] || name;

const SORTED_LAW_NAMES = [...new Set([...Object.keys(PCODE_MAP), ...Object.keys(ALIAS_MAP)])].sort(
  (a, b) => b.length - a.length,
);

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
    must: [{ text: { query: resolvedName, path: ['law_name', 'aliases'] } }],
  };
};

// ── Embedding & Vector Search ──

const embedQuery = async (text, apiKey) => {
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
  const json = await res.json();
  if (!json.data?.[0]?.embedding) {
    throw new Error(`Embedding API returned no data`);
  }
  return json.data[0].embedding;
};

const filteredVectorSearch = async (coll, queryVector, limit, filter = {}) => {
  const searchFilter = {};
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
    .toArray();
};

/**
 * Vector-first merge: vector results ranked first (superior semantic relevance),
 * keyword results fill remaining slots (deduplicated).
 * Experimentally validated: MRR 0.536 vs RRF's 0.353 on 22-query benchmark.
 */
const vectorFirstMerge = (keywordResults, vectorResults, limit) => {
  const seen = new Set();
  const out = [];

  // Vector results first — better semantic ranking
  for (const r of vectorResults) {
    if (!seen.has(r._id)) {
      seen.add(r._id);
      out.push({ ...r, score: 1 - out.length * 0.01, source: 'vector' });
    }
  }

  // Keyword backfill — adds diversity, catches exact matches vector may miss
  for (const r of keywordResults) {
    if (!seen.has(r._id) && out.length < limit) {
      seen.add(r._id);
      out.push({ ...r, score: 0.5 - out.length * 0.01, source: 'keyword' });
    }
  }

  // Mark items that appear in both
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

const searchWithCollection = async (coll, query, opts = {}) => {
  const { limit = 5, apiKey, lawName } = opts;
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
            source: 'keyword',
          })),
          strategy: 'S1_regex',
          time: Date.now() - start,
        };
      }
    }
  }

  // ── Helper: run Atlas Search keyword query ──
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

  // ── S2: Article search via Atlas ──
  if (articleMatch && artResolvedName && artNormalized) {
    const compound = {
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

  // Step 1: Extract law name and concept
  let resolvedLawName;
  let keywordConcept;

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

  // Step 2: Resolve pcode
  const pcode = resolvedLawName ? PCODE_MAP[resolvedLawName] : undefined;

  // Step 3: Build keyword compound query
  const buildConceptKeywordCompound = () => {
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

  // Step 4: Run hybrid or keyword-only
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
      strategyType = 'keyword_fallback'; // hybrid returned empty, try keyword
    } catch (err) {
      console.warn(`        [hybrid failed: ${err.message}]`);
      strategyType = 'keyword_fallback';
    }
  }

  // Keyword-only fallback
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
//
// 新增案例格式：
//   query:          搜尋字串
//   expect:         預期策略前綴 ('S0' / 'S1' / 'S2')
//   expectArticle:  可選，預期 top1 的 article_no
//   mustContainLaw: 可選，結果必須包含此 law_name
//   lawName:        可選，傳入 law_name 參數
//   category:       測試分類標籤
//   desc:           測試描述
// ══════════════════════════════════════════════════════════════

const TEST_CASES = [
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
  {
    query: '民法 損害賠償',
    expect: 'S2',
    category: 'C',
    desc: '損害賠償',
    mustContainLaw: '民法',
  },
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
  {
    query: '刑法 詐欺',
    expect: 'S2',
    category: 'C',
    desc: '詐欺',
    mustContainLaw: '中華民國刑法',
  },
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
  {
    query: '票據法第14條',
    expect: 'S0',
    expectArticle: '第 14 條',
    category: 'E',
    desc: '票據法',
  },
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
  {
    query: '民法 物之瑕疵',
    expect: 'S2',
    category: 'E',
    desc: '物之瑕疵',
    mustContainLaw: '民法',
  },

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

const main = async () => {
  const client = new MongoClient(MONGO_URL, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const coll = client.db('lawdb').collection('articles');
    console.log(`Connected to MongoDB (hybrid: ${MONGO_API_KEY ? 'enabled' : 'disabled'})\n`);

    const results = [];
    let passCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let totalTime = 0;
    let currentCategory = '';

    for (const tc of TEST_CASES) {
      // Print category header
      if (tc.category !== currentCategory) {
        currentCategory = tc.category;
        const categoryNames = {
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
        console.log(`\n── ${categoryNames[tc.category] || tc.category} ──\n`);
      }

      // Skip vector-dependent tests if no API key
      const needsVector = ['F', 'G'].includes(tc.category);
      if (needsVector && !MONGO_API_KEY) {
        skipCount++;
        console.log(`\x1b[33m SKIP \x1b[0m ${tc.desc} (no MONGO_API_KEY)`);
        console.log('');
        results.push({ ...tc, ok: null, strategy: 'skipped', time: 0 });
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
          (r) => r.law_name === tc.mustContainLaw || r.law_name?.includes(tc.mustContainLaw),
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
      if (!hasResults) console.log(`        No results returned`);
      if (!lawOk)
        console.log(
          `        Wrong law: expected ${tc.mustContainLaw}, got: ${res.results.map((r) => r.law_name).join(', ')}`,
        );

      // Show top 3 for concept searches with source tags
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
    const byStrategy = {};
    for (const r of results) {
      if (r.ok === null) continue; // skipped
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
    const byCategory = {};
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

    // Exit code for CI (only count actual failures, not skips)
    process.exit(failCount > 0 ? 1 : 0);
  } finally {
    await client.close();
  }
};

main().catch((err) => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
