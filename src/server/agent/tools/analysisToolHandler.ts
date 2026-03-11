/**
 * Factory for analysis tool handlers (disputes, damages, timeline).
 * Separated from toolHelpers to avoid circular dependency with analysisService.
 */
import { toolError } from '../toolHelpers';
import { runAnalysis, type DeepDisputeSuccess } from '../../services/analysisService';
import type { ToolHandler } from './types';
import type { AnalysisType } from '../../../shared/types';

const ANALYSIS_SSE_ACTIONS = {
  disputes: 'set_disputes',
  damages: 'set_damages',
  timeline: 'set_timeline',
} as const;

/**
 * Create a ToolHandler for a given analysis type.
 * All three analysis tools (disputes, damages, timeline) share identical logic.
 */
export const makeAnalysisToolHandler =
  (type: AnalysisType): ToolHandler =>
  async (_args, caseId, db, drizzle, ctx) => {
    if (!ctx) return toolError('Error: missing execution context');

    const result = await runAnalysis(type, caseId, db, drizzle, ctx.aiEnv);

    if (!result.success) {
      return { result: result.error, success: false };
    }

    await ctx.sendSSE({
      type: 'brief_update',
      brief_id: '',
      action: ANALYSIS_SSE_ACTIONS[type],
      data: result.data,
    });

    // For disputes, also send undisputed_facts + information_gaps
    if (type === 'disputes' && 'orchestratorOutput' in result) {
      const { orchestratorOutput } = result as DeepDisputeSuccess;
      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: '',
        action: 'set_undisputed_facts',
        data: orchestratorOutput.undisputedFacts,
      });
      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: '',
        action: 'set_information_gaps',
        data: orchestratorOutput.informationGaps,
      });
    }

    return { result: result.summary, success: true };
  };
