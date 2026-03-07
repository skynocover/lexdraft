const CHINESE_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export const toChineseNumber = (n: number): string => {
  if (n <= 0) return '';
  if (n < 10) return CHINESE_DIGITS[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${tens > 1 ? CHINESE_DIGITS[tens] : ''}十${CHINESE_DIGITS[ones]}`;
  }
  return String(n);
};

export const toChineseExhibitLabel = (prefix: string, number: number): string =>
  `${prefix}${toChineseNumber(number)}`;
