import { getDB } from '../../db';
import { TOOL_DEFINITIONS } from './definitions';
import type { ToolContext, ToolHandler } from './types';

import { handleListFiles } from './listFiles';
import { handleReadFile } from './readFile';
import { handleCreateBrief } from './createBrief';
import { handleWriteBriefSection } from './writeBriefSection';
import { handleAnalyzeDisputes } from './analyzeDisputes';
import { handleCalculateDamages } from './calculateDamages';
import { handleSearchLaw } from './searchLaw';
import { handleGenerateTimeline } from './generateTimeline';
import { handleWriteFullBrief } from './writeFullBrief';
import { handleQualityReview } from './qualityReview';

const handlers: Record<string, ToolHandler> = {
  list_files: handleListFiles,
  read_file: handleReadFile,
  create_brief: handleCreateBrief,
  write_brief_section: handleWriteBriefSection,
  analyze_disputes: handleAnalyzeDisputes,
  calculate_damages: handleCalculateDamages,
  search_law: handleSearchLaw,
  generate_timeline: handleGenerateTimeline,
  write_full_brief: handleWriteFullBrief,
  review_brief: handleQualityReview,
};

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  caseId: string,
  db: D1Database,
  ctx?: ToolContext,
): Promise<{ result: string; success: boolean }> {
  const handler = handlers[toolName];
  if (!handler) {
    return { result: `Unknown tool: ${toolName}`, success: false };
  }
  const drizzle = getDB(db);
  return handler(args, caseId, db, drizzle, ctx);
}

export { TOOL_DEFINITIONS };
export type { ToolContext };
