/**
 * 將日期字串轉為民國年格式。
 * - 西元年 (>= 1912) → 民國年 (e.g. 2024-10-12 → 113-10-12)
 * - 年份 < 200 → 視為已是民國年，原樣回傳
 */
export const formatROCDate = (dateStr: string): string => {
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;

  const year = parseInt(parts[0], 10);
  if (isNaN(year)) return dateStr;

  if (year < 200) return dateStr;

  const rocYear = year - 1911;
  return `${rocYear}-${parts[1]}-${parts[2]}`;
};
