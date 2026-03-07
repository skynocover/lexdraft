import { getDB } from '../../db';
import { runBriefPipeline } from '../briefPipeline';
import { toolError } from '../toolHelpers';
import type { ToolHandler } from './types';

export const handleWriteFullBrief: ToolHandler = async (args, caseId, db, drizzle, ctx) => {
  if (!ctx) {
    return toolError('Error: missing execution context');
  }

  const templateId = (args.template_id as string) || null;
  const title = args.title as string;

  if (!title) {
    return toolError('Error: title is required');
  }

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
