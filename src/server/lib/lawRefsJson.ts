import { eq } from 'drizzle-orm';
import { cases } from '../db/schema';
import type { getDB } from '../db';

export interface LawRefItem {
  id: string;
  law_name: string;
  article: string;
  full_text: string;
  is_manual: boolean;
}

type Drizzle = ReturnType<typeof getDB>;

const parseLawRefs = (raw: string | null): LawRefItem[] => {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LawRefItem[];
  } catch {
    return [];
  }
};

export const readLawRefs = async (drizzle: Drizzle, caseId: string): Promise<LawRefItem[]> => {
  const rows = await drizzle
    .select({ law_refs: cases.law_refs })
    .from(cases)
    .where(eq(cases.id, caseId));
  if (!rows.length) return [];
  return parseLawRefs(rows[0].law_refs);
};

const writeLawRefs = async (
  drizzle: Drizzle,
  caseId: string,
  refs: LawRefItem[],
): Promise<void> => {
  await drizzle
    .update(cases)
    .set({ law_refs: JSON.stringify(refs) })
    .where(eq(cases.id, caseId));
};

export const upsertManyLawRefs = async (
  drizzle: Drizzle,
  caseId: string,
  refs: LawRefItem[],
): Promise<LawRefItem[]> => {
  const existing = await readLawRefs(drizzle, caseId);
  for (const ref of refs) {
    const idx = existing.findIndex((r) => r.id === ref.id);
    if (idx >= 0) {
      existing[idx] = ref;
    } else {
      existing.push(ref);
    }
  }
  await writeLawRefs(drizzle, caseId, existing);
  return existing;
};

export const removeLawRef = async (
  drizzle: Drizzle,
  caseId: string,
  refId: string,
): Promise<LawRefItem[]> => {
  const existing = await readLawRefs(drizzle, caseId);
  const filtered = existing.filter((r) => r.id !== refId);
  await writeLawRefs(drizzle, caseId, filtered);
  return filtered;
};

export const removeLawRefsWhere = async (
  drizzle: Drizzle,
  caseId: string,
  predicate: (r: LawRefItem) => boolean,
): Promise<LawRefItem[]> => {
  const existing = await readLawRefs(drizzle, caseId);
  const filtered = existing.filter((r) => !predicate(r));
  await writeLawRefs(drizzle, caseId, filtered);
  return filtered;
};

export const hasLawRefByNameArticle = (
  refs: LawRefItem[],
  lawName: string,
  article: string,
): boolean => {
  return refs.some((r) => r.law_name === lawName && r.article === article);
};
