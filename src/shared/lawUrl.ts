/**
 * 從 MongoDB _id 格式 "{pcode}-{number}" 提取 pcode
 * e.g. "B0000001-184" → "B0000001"
 */
export const extractPcode = (lawRefId: string): string | null => {
  const dashIdx = lawRefId.indexOf('-');
  if (dashIdx <= 0) return null;
  return lawRefId.slice(0, dashIdx);
};

/**
 * 建構全國法規資料庫 URL
 * - 有條號 → LawSingle（直接跳到該條）
 * - 無條號 → LawAll（整部法規）
 */
export const buildLawUrl = (pcode: string, articleNo?: string): string | null => {
  if (!pcode) return null;
  const num = articleNo?.match(/第\s*(\d+(?:-\d+)?)\s*條/)?.[1];
  if (num) {
    return `https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=${pcode}&flno=${num}`;
  }
  return `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${pcode}`;
};
