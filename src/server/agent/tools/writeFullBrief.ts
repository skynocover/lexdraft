import { runBriefPipeline } from '../briefPipeline';
import { toolError } from '../toolHelpers';
import { getTemplateById } from '../../lib/defaultTemplates';
import { resolvePipelineMode } from '../prompts/strategyConstants';
import { templates, cases } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { BRIEF_MODE_VALUES, type BriefModeValue } from '../../../shared/caseConstants';
import type { getDB } from '../../db';
import type { ToolHandler } from './types';

/** Resolve briefMode: system template → from code; custom → from DB; fallback → null */
const resolveBriefMode = async (
  templateId: string | null,
  drizzle: ReturnType<typeof getDB>,
): Promise<BriefModeValue | null> => {
  if (!templateId) return null;
  const systemTpl = getTemplateById(templateId);
  if (systemTpl) return systemTpl.briefMode;
  const rows = await drizzle
    .select({ brief_mode: templates.brief_mode })
    .from(templates)
    .where(eq(templates.id, templateId));
  const raw = rows[0]?.brief_mode;
  return raw && (BRIEF_MODE_VALUES as readonly string[]).includes(raw)
    ? (raw as BriefModeValue)
    : null;
};

export const handleWriteFullBrief: ToolHandler = async (args, caseId, db, drizzle, ctx) => {
  if (!ctx) {
    return toolError('Error: missing execution context');
  }

  const templateId = (args.template_id as string) || null;
  const title = args.title as string;

  if (!title) {
    return toolError('Error: title is required');
  }

  const briefMode = await resolveBriefMode(templateId, drizzle);
  let clientRole: string | undefined;
  if (briefMode === 'supplement') {
    const caseRow = await drizzle
      .select({ client_role: cases.client_role })
      .from(cases)
      .where(eq(cases.id, caseId));
    clientRole = caseRow[0]?.client_role || undefined;
  }
  const pipelineMode = resolvePipelineMode(briefMode, clientRole);
  const signal = ctx.signal || new AbortController().signal;

  const pipelineOpts = ctx.enableSnapshots
    ? {
        onStepComplete: async (stepName: string, data: unknown) => {
          await ctx.sendSSE({ type: 'snapshot_data', stepName, data });
        },
      }
    : undefined;

  return runBriefPipeline(
    {
      caseId,
      templateId,
      briefMode,
      pipelineMode,
      title,
      signal,
      sendSSE: ctx.sendSSE,
      db,
      drizzle,
      aiEnv: ctx.aiEnv,
      mongoUrl: ctx.mongoUrl,
      mongoApiKey: ctx.mongoApiKey,
    },
    pipelineOpts,
  );
};
