// ── Evidence Formatter ──
// Programmatically generates 證據方法 section from exhibits table.

import { eq } from 'drizzle-orm';
import { exhibits } from '../../db/schema';
import type { getDB } from '../../db';
import { toChineseExhibitLabel } from '../../lib/exhibitAssign';

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
    const label = toChineseExhibitLabel(r.prefix || '', r.number || 0);
    const desc = r.description || '';
    const docType = r.doc_type || '影本';
    return `${label}　${desc}　　${docType}`;
  });

  return lines.join('\n');
};
