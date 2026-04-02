import type { getDB } from '../db';

/**
 * Batch insert rows to work around D1's 100-bound-parameter limit.
 * @param batchSize - max rows per INSERT (e.g. 12 for 8-column tables → 96 params)
 */
export const batchInsert = async <T extends Record<string, unknown>>(
  drizzle: ReturnType<typeof getDB>,
  table: Parameters<ReturnType<typeof getDB>['insert']>[0],
  rows: T[],
  batchSize: number,
): Promise<void> => {
  for (let i = 0; i < rows.length; i += batchSize) {
    await drizzle.insert(table).values(rows.slice(i, i + batchSize));
  }
};
