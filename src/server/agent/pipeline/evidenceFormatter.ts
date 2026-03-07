// ── Evidence Formatter ──
// Programmatically generates 證據方法 section from exhibits table.

import { eq } from 'drizzle-orm';
import { exhibits } from '../../db/schema';
import type { getDB } from '../../db';

const CHINESE_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

const toChineseNumber = (n: number): string => {
  if (n <= 0) return '';
  if (n < 10) return CHINESE_DIGITS[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${tens > 1 ? CHINESE_DIGITS[tens] : ''}十${CHINESE_DIGITS[ones]}`;
  }
  return String(n);
};

/** 從 exhibits 表產生證據方法段落文字 */
export const formatEvidenceSection = async (
  drizzle: ReturnType<typeof getDB>,
  caseId: string,
): Promise<string | null> => {
  const rows = await drizzle
    .select({
      prefix: exhibits.prefix,
      number: exhibits.number,
      description: exhibits.description,
      doc_type: exhibits.doc_type,
    })
    .from(exhibits)
    .where(eq(exhibits.case_id, caseId));

  if (rows.length === 0) return null;

  // Sort: group by prefix (甲證 first, then 乙證, etc.), then by number
  const sorted = rows.sort((a, b) => {
    const prefixOrder = (a.prefix || '').localeCompare(b.prefix || '');
    if (prefixOrder !== 0) return prefixOrder;
    return (a.number || 0) - (b.number || 0);
  });

  const lines = sorted.map((r) => {
    const label = `${r.prefix || ''}${toChineseNumber(r.number || 0)}`;
    const desc = r.description || '';
    const docType = r.doc_type || '影本';
    return `${label}　${desc}　　${docType}`;
  });

  return lines.join('\n');
};
