/**
 * 台灣法規常量表與條號格式化工具
 * - PCODE_MAP: 高頻法規名稱 → PCode 對照
 * - ALIAS_MAP: 常見縮寫 → 全名對照
 * - resolveAlias / normalizeArticleNo / buildArticleId: 格式工具
 */

/** 高頻法規名稱 → PCode（來源：全國法規資料庫 FalVMingLing JSON） */
export const PCODE_MAP: Record<string, string> = {
  // 民事
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
  // 刑事
  刑法: 'C0000001',
  刑事訴訟法: 'C0010001',
  少年事件處理法: 'C0010011',
  刑事補償法: 'C0010009',
  國民法官法: 'A0030320',
  犯罪被害人權益保障法: 'I0050005',
  // 商事
  公司法: 'J0080001',
  證券交易法: 'G0400001',
  票據法: 'G0380028',
  海商法: 'K0070002',
  保險法: 'G0390002',
  商業會計法: 'J0080009',
  企業併購法: 'J0080041',
  // 勞動
  勞動基準法: 'N0030001',
  勞工保險條例: 'N0050001',
  勞動事件法: 'B0010064',
  職業安全衛生法: 'N0060001',
  職業災害勞工保護法: 'N0060041',
  就業服務法: 'N0090001',
  性別平等工作法: 'N0030014',
  勞資爭議處理法: 'N0020007',
  // 智財
  著作權法: 'J0070017',
  專利法: 'J0070007',
  商標法: 'J0070001',
  營業秘密法: 'J0080028',
  // 行政
  行政程序法: 'A0030055',
  行政訴訟法: 'A0030154',
  訴願法: 'A0030020',
  行政執行法: 'A0030023',
  行政罰法: 'A0030210',
  國家賠償法: 'I0020004',
  政府採購法: 'A0030057',
  // 稅法
  稅捐稽徵法: 'G0340001',
  所得稅法: 'G0340003',
  加值型及非加值型營業稅法: 'G0340080',
  遺產及贈與稅法: 'G0340072',
  房屋稅條例: 'G0340102',
  土地稅法: 'G0340096',
  // 土地不動產
  土地法: 'D0060001',
  土地登記規則: 'D0060003',
  耕地三七五減租條例: 'D0060008',
  平均地權條例: 'D0060009',
  都市計畫法: 'D0070001',
  建築法: 'D0070109',
  區域計畫法: 'D0070030',
  // 交通
  道路交通管理處罰條例: 'K0040012',
  道路交通安全規則: 'K0040013',
  // 個資
  個人資料保護法: 'I0050021',
  電子簽章法: 'J0080037',
  // 金融
  銀行法: 'G0380001',
  金融消費者保護法: 'G0380226',
  信託法: 'I0020024',
  洗錢防制法: 'G0380131',
  // 醫療
  醫療法: 'L0020021',
  藥事法: 'L0030001',
  全民健康保險法: 'L0060001',
  // 環境
  環境基本法: 'O0100001',
  廢棄物清理法: 'O0050001',
  水污染防治法: 'O0040001',
  空氣污染防制法: 'O0020001',
  // 其他常用
  社會秩序維護法: 'D0080067',
  通訊保障及監察法: 'K0060044',
  仲裁法: 'I0020001',
  法律扶助法: 'A0030157',
  鄉鎮市調解條例: 'I0020003',
  公職人員選舉罷免法: 'D0020010',
  憲法訴訟法: 'A0030159',
};

/** 常見法規縮寫 → 全名 */
export const ALIAS_MAP: Record<string, string> = {
  // 民事
  民訴法: '民事訴訟法',
  民訴: '民事訴訟法',
  強執法: '強制執行法',
  家事法: '家事事件法',
  消保法: '消費者保護法',
  公大條例: '公寓大廈管理條例',
  // 刑事
  中華民國刑法: '刑法',
  刑訴法: '刑事訴訟法',
  刑訴: '刑事訴訟法',
  // 商事
  證交法: '證券交易法',
  // 勞動
  勞基法: '勞動基準法',
  勞保條例: '勞工保險條例',
  勞事法: '勞動事件法',
  職安法: '職業安全衛生法',
  性平法: '性別平等工作法',
  性工法: '性別平等工作法',
  勞爭法: '勞資爭議處理法',
  // 智財
  著作權: '著作權法',
  營秘法: '營業秘密法',
  // 行政
  行程法: '行政程序法',
  行政訴訟: '行政訴訟法',
  國賠法: '國家賠償法',
  行罰法: '行政罰法',
  政採法: '政府採購法',
  // 稅法
  稅捐法: '稅捐稽徵法',
  所得稅: '所得稅法',
  營業稅: '加值型及非加值型營業稅法',
  營業稅法: '加值型及非加值型營業稅法',
  遺贈稅法: '遺產及贈與稅法',
  // 交通
  道交條例: '道路交通管理處罰條例',
  道交處罰條例: '道路交通管理處罰條例',
  道交管理條例: '道路交通管理處罰條例',
  道安規則: '道路交通安全規則',
  交通安全規則: '道路交通安全規則',
  // 個資
  個資法: '個人資料保護法',
  // 金融
  金保法: '金融消費者保護法',
  洗防法: '洗錢防制法',
  // 醫療
  健保法: '全民健康保險法',
  // 其他
  仲裁: '仲裁法',
  都計法: '都市計畫法',
};

/** 解析縮寫為全名，查不到則原樣返回 */
export const resolveAlias = (name: string, dbAliases?: Record<string, string>): string => {
  return ALIAS_MAP[name] || dbAliases?.[name] || name;
};

/** 常見法律概念 → 目標法規 + 改寫詞（用於純概念搜尋的改寫） */
export const CONCEPT_TO_LAW: Record<string, { law: string; concept?: string }> = {
  // 民法 — 債
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
  // 民法 — 侵權
  侵權行為: { law: '民法' },
  僱用人責任: { law: '民法', concept: '僱用人' },
  慰撫金: { law: '民法' },
  精神慰撫金: { law: '民法', concept: '慰撫金' },
  精神賠償: { law: '民法', concept: '慰撫金' },
  勞動能力: { law: '民法' },
  勞動能力減損: { law: '民法', concept: '勞動能力' },
  // 民法 — 物權
  善意取得: { law: '民法', concept: '善意受讓' },
  所有權: { law: '民法' },
  抵押權: { law: '民法' },
  留置權: { law: '民法' },
  // 民法 — 總則
  消滅時效: { law: '民法' },
  意思表示: { law: '民法' },
  // 刑法
  過失傷害: { law: '刑法' },
  過失致死: { law: '刑法' },
  詐欺: { law: '刑法' },
  背信: { law: '刑法' },
  誹謗: { law: '刑法' },
  公然侮辱: { law: '刑法' },
  傷害: { law: '刑法' },
  // 程序法
  舉證責任: { law: '民事訴訟法', concept: '舉證' },
  假扣押: { law: '民事訴訟法' },
  假處分: { law: '民事訴訟法' },
  強制執行: { law: '強制執行法' },
  // 消保
  定型化契約: { law: '消費者保護法' },
  商品責任: { law: '消費者保護法', concept: '商品' },
  // 勞動
  解僱: { law: '勞動基準法', concept: '終止契約' },
  資遣: { law: '勞動基準法' },
  職業災害: { law: '勞動基準法' },
  加班: { law: '勞動基準法', concept: '延長工時' },
  工作加班: { law: '勞動基準法', concept: '延長工時' },
  // 口語複合
  車禍賠償: { law: '民法', concept: '損害賠償' },
  醫療糾紛: { law: '醫療法', concept: '醫療' },
  國家賠償: { law: '國家賠償法' },
};

/** CONCEPT_TO_LAW keys sorted longest first for greedy matching */
const SORTED_CONCEPTS = Object.keys(CONCEPT_TO_LAW).sort((a, b) => b.length - a.length);

/**
 * 嘗試將純概念查詢改寫為 lawName + concept
 * e.g. "損害賠償" → { lawName: "民法", concept: "損害賠償" }
 * e.g. "精神慰撫金" → { lawName: "民法", concept: "慰撫金" }
 * Returns null if no match found.
 */
export const tryRewriteQuery = (query: string): { lawName: string; concept: string } | null => {
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

/**
 * 將各種條號格式標準化為 article_no 欄位格式
 * - 第184條 → 第 184 條
 * - 第166條之1 → 第 166-1 條
 * - §213 → 第 213 條
 * - 184（純數字）→ 第 184 條
 */
export const normalizeArticleNo = (raw: string): string => {
  let s = raw.trim();

  // 移除前綴 § 符號
  if (s.startsWith('§')) {
    s = s.slice(1).trim();
  }

  // 純數字 → 第 N 條
  if (/^\d+$/.test(s)) {
    return `第 ${s} 條`;
  }

  // 第N條之M → 第 N-M 條
  const fullMatch = s.match(/^第\s*(\d+)\s*條\s*之\s*(\d+)$/);
  if (fullMatch) {
    return `第 ${fullMatch[1]}-${fullMatch[2]} 條`;
  }

  // 第N條 → 第 N 條
  const simpleMatch = s.match(/^第\s*(\d+)\s*條$/);
  if (simpleMatch) {
    return `第 ${simpleMatch[1]} 條`;
  }

  // 無法解析，原樣返回
  return s;
};

/**
 * 從標準化的 article_no 提取 _id 用的數字部分
 * - "第 184 條" → "184"
 * - "第 191-2 條" → "191-2"
 */
const extractArticleNum = (articleNo: string): string | null => {
  const m = articleNo.match(/第\s*(\d+(?:-\d+)?)\s*條/);
  return m ? m[1] : null;
};

/**
 * 組合 {pcode}-{number} 格式的 MongoDB _id
 * 例如: buildArticleId('民法', '第 184 條') → 'B0000001-184'
 * 如果找不到 PCode 則返回 null
 */
export const buildArticleId = (lawName: string, articleNo: string): string | null => {
  const pcode = PCODE_MAP[lawName];
  if (!pcode) return null;
  const num = extractArticleNum(articleNo);
  if (!num) return null;
  return `${pcode}-${num}`;
};
