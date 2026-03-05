// ── Pipeline Persistence Layer ──
// Centralized DB writes + paired SSE notifications for the brief pipeline.

import { eq, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { briefs, briefVersions, claims } from '../../db/schema';
import { upsertManyLawRefs } from '../../lib/lawRefsJson';
import type { LawRefItem } from '../../lib/lawRefsJson';
import type { Claim, PipelineContext } from './types';
import type { Paragraph } from '../../../client/stores/useBriefStore';

const CLAIM_BATCH_SIZE = 10;

/** Delete old claims, batch insert new ones, notify frontend via SSE. */
export const persistClaims = async (ctx: PipelineContext, claimList: Claim[]): Promise<void> => {
  await ctx.drizzle.delete(claims).where(eq(claims.case_id, ctx.caseId));
  const now = new Date().toISOString();
  for (let i = 0; i < claimList.length; i += CLAIM_BATCH_SIZE) {
    const batch = claimList.slice(i, i + CLAIM_BATCH_SIZE);
    await ctx.drizzle.insert(claims).values(
      batch.map((c) => ({
        id: c.id,
        case_id: ctx.caseId,
        side: c.side,
        claim_type: c.claim_type,
        statement: c.statement,
        assigned_section: c.assigned_section,
        dispute_id: c.dispute_id,
        responds_to: c.responds_to,
        created_at: now,
      })),
    );
  }

  await ctx.sendSSE({
    type: 'brief_update',
    brief_id: '',
    action: 'set_claims',
    data: claimList,
  });
};

/** Write all paragraphs to briefs table in a single UPDATE. */
export const persistBriefContent = async (
  ctx: PipelineContext,
  briefId: string,
  paragraphs: Paragraph[],
): Promise<void> => {
  if (paragraphs.length === 0) return;
  await ctx.drizzle
    .update(briefs)
    .set({
      content_structured: JSON.stringify({ paragraphs }),
      updated_at: new Date().toISOString(),
    })
    .where(eq(briefs.id, briefId));
};

/** Save a version snapshot for the completed pipeline run. */
export const saveBriefVersion = async (
  ctx: PipelineContext,
  briefId: string,
  paragraphs: Paragraph[],
): Promise<void> => {
  const [{ maxNo }] = await ctx.drizzle
    .select({ maxNo: max(briefVersions.version_no) })
    .from(briefVersions)
    .where(eq(briefVersions.brief_id, briefId));

  await ctx.drizzle.insert(briefVersions).values({
    id: nanoid(),
    brief_id: briefId,
    version_no: (maxNo ?? 0) + 1,
    label: `AI 撰寫完成（${paragraphs.length} 段）`,
    content_structured: JSON.stringify({ paragraphs }),
    created_at: new Date().toISOString(),
    created_by: 'ai',
  });
};

/** Upsert fetched law refs into the case's law_refs JSON column. */
export const persistLawRefs = async (
  ctx: PipelineContext,
  lawRefs: LawRefItem[],
): Promise<void> => {
  if (lawRefs.length === 0) return;
  await upsertManyLawRefs(ctx.drizzle, ctx.caseId, lawRefs);
};
