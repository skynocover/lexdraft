import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { exhibits } from '../db/schema';
import type { getDB } from '../db';
import type { Paragraph } from '../../client/stores/useBriefStore';

// ── Types ──

export interface ExhibitInput {
  file_id: string;
  prefix: string;
  number: number;
  doc_type: string;
  description: string | null;
}

export interface ExistingExhibit {
  id: string;
  file_id: string;
  prefix: string | null;
  number: number | null;
}

export interface FileInfo {
  id: string;
  filename?: string | null;
  category: string | null;
  summary: string | null;
}

// ── Prefix Matrix ──

export const getExhibitPrefix = (fileCategory: string | null): string | null => {
  if (fileCategory === 'exhibit_a') return '甲證';
  if (fileCategory === 'exhibit_b') return '乙證';
  return null;
};

// ── Description Derivation ──

export const deriveExhibitDescription = (summary: string | null): string | null => {
  if (!summary) return null;
  // Take the first sentence (ending with 。or .)
  const match = summary.match(/^[^。.]+[。.]/);
  return match ? match[0] : summary.slice(0, 100);
};

// ── Auto-assign ──

export const assignExhibits = (
  paragraphs: Paragraph[],
  _clientRole: 'plaintiff' | 'defendant',
  files: FileInfo[],
  existingExhibits: ExistingExhibit[],
): ExhibitInput[] => {
  const fileMap = new Map(files.map((f) => [f.id, f]));
  const existingFileIds = new Set(existingExhibits.map((e) => e.file_id));

  // Find max existing number per prefix
  const maxNumbers = new Map<string, number>();
  for (const e of existingExhibits) {
    if (e.prefix && e.number != null) {
      const current = maxNumbers.get(e.prefix) ?? 0;
      if (e.number > current) maxNumbers.set(e.prefix, e.number);
    }
  }

  // Walk paragraphs → segments → citations to collect new file_ids in order
  const seenFileIds = new Set<string>();
  const newFileIds: string[] = [];

  for (const p of paragraphs) {
    const walkCitations = (citations: { type: string; file_id?: string }[]) => {
      for (const c of citations) {
        if (
          c.type === 'file' &&
          c.file_id &&
          !existingFileIds.has(c.file_id) &&
          !seenFileIds.has(c.file_id)
        ) {
          seenFileIds.add(c.file_id);
          newFileIds.push(c.file_id);
        }
      }
    };

    // Walk segments first (preferred structure), then fallback to paragraph-level citations
    if (p.segments && p.segments.length > 0) {
      for (const seg of p.segments) {
        walkCitations(seg.citations);
      }
    }
    walkCitations(p.citations);
  }

  // Assign numbers
  const results: ExhibitInput[] = [];

  for (const fileId of newFileIds) {
    const file = fileMap.get(fileId);
    if (!file) continue;

    const prefix = getExhibitPrefix(file.category);
    if (!prefix) continue; // court/other → skip

    const currentMax = maxNumbers.get(prefix) ?? 0;
    const number = currentMax + 1;
    maxNumbers.set(prefix, number);

    // Use filename (without extension) as exhibit description — concise and unambiguous
    const filename = file.filename || '';
    const baseName = filename.replace(/\.[^.]+$/, '');

    results.push({
      file_id: fileId,
      prefix,
      number,
      doc_type: '影本',
      description: baseName || deriveExhibitDescription(file.summary),
    });
  }

  return results;
};

// ── Build exhibit label from prefix + number ──

export const buildExhibitLabel = (prefix: string | null, number: number | null): string | null => {
  if (!prefix || number == null) return null;
  return `${prefix}${number}`;
};

// ── Build file_id → label map ──

export const buildExhibitMap = (
  exhibits: { file_id: string; prefix: string | null; number: number | null }[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const e of exhibits) {
    const label = buildExhibitLabel(e.prefix, e.number);
    if (label) map.set(e.file_id, label);
  }
  return map;
};

// ── DB Helpers (shared by files.ts + exhibits.ts routes) ──

export const getMaxExhibitNumber = async (
  db: ReturnType<typeof getDB>,
  caseId: string,
  prefix: string,
): Promise<number> => {
  const rows = await db
    .select({ number: exhibits.number })
    .from(exhibits)
    .where(and(eq(exhibits.case_id, caseId), eq(exhibits.prefix, prefix)))
    .orderBy(exhibits.number);
  return rows.length > 0 ? (rows[rows.length - 1].number ?? 0) : 0;
};

export const renumberExhibitPrefix = async (
  db: ReturnType<typeof getDB>,
  caseId: string,
  prefix: string,
) => {
  const rows = await db
    .select({ id: exhibits.id })
    .from(exhibits)
    .where(and(eq(exhibits.case_id, caseId), eq(exhibits.prefix, prefix)))
    .orderBy(exhibits.number);

  for (let i = 0; i < rows.length; i++) {
    await db
      .update(exhibits)
      .set({ number: i + 1 })
      .where(eq(exhibits.id, rows[i].id));
  }
};

// ── Generate nanoid for new exhibit rows ──

export const toExhibitRows = (
  caseId: string,
  inputs: ExhibitInput[],
): Array<{
  id: string;
  case_id: string;
  file_id: string;
  prefix: string;
  number: number;
  doc_type: string;
  description: string | null;
  created_at: string;
}> =>
  inputs.map((input) => ({
    id: nanoid(),
    case_id: caseId,
    file_id: input.file_id,
    prefix: input.prefix,
    number: input.number,
    doc_type: input.doc_type,
    description: input.description,
    created_at: new Date().toISOString(),
  }));
