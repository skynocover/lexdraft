/**
 * 台灣法規常量表與條號格式化工具
 * - PCODE_MAP: 高頻法規名稱 → PCode 對照
 * - ALIAS_MAP: 常見縮寫 → 全名對照
 * - resolveAlias / normalizeArticleNo / buildArticleId: 格式工具
 */

/** 高頻法規名稱 → PCode */
export const PCODE_MAP: Record<string, string> = {
  民法: 'B0000001',
  刑法: 'C0000001',
  民事訴訟法: 'B0010001',
  刑事訴訟法: 'C0010001',
  行政訴訟法: 'I0020020',
  公司法: 'J0080001',
  勞動基準法: 'N0030001',
  消費者保護法: 'J0170001',
  個人資料保護法: 'I0050021',
  道路交通管理處罰條例: 'K0040012',
  強制執行法: 'B0010004',
  國家賠償法: 'I0020004',
  行政程序法: 'I0020015',
  土地法: 'D0060001',
  著作權法: 'J0070017',
  專利法: 'J0070007',
  商標法: 'J0070001',
  保險法: 'G0390002',
  證券交易法: 'G0400001',
  家事事件法: 'B0010052',
  稅捐稽徵法: 'G0340001',
};

/** 常見法規縮寫 → 全名 */
export const ALIAS_MAP: Record<string, string> = {
  消保法: '消費者保護法',
  勞基法: '勞動基準法',
  個資法: '個人資料保護法',
  國賠法: '國家賠償法',
  行政訴訟: '行政訴訟法',
  民訴法: '民事訴訟法',
  民訴: '民事訴訟法',
  刑訴法: '刑事訴訟法',
  刑訴: '刑事訴訟法',
  行程法: '行政程序法',
  強執法: '強制執行法',
  著作權: '著作權法',
  道交條例: '道路交通管理處罰條例',
  家事法: '家事事件法',
  證交法: '證券交易法',
  稅捐法: '稅捐稽徵法',
};

/** 解析縮寫為全名，查不到則原樣返回 */
export const resolveAlias = (name: string): string => {
  return ALIAS_MAP[name] || name;
};

/**
 * 將各種條號格式標準化為 MongoDB _id 中使用的格式
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
 * 組合 {pcode}-{條號} 格式的 _id
 * 如果找不到 PCode 則返回 null
 */
export const buildArticleId = (lawName: string, articleNo: string): string | null => {
  const pcode = PCODE_MAP[lawName];
  if (!pcode) return null;
  return `${pcode}-${articleNo}`;
};
