/**
 * Generic factory for analysis tools (disputes, damages, timeline).
 * All three follow the same flow:
 *   ctx check → loadReadyFiles → buildFileContext → callAnalysisAI
 *   → parseLLMJsonArray → preProcess → persistAndNotify → return summary
 */
import type { getDB } from '../../db';
import {
  toolError,
  loadReadyFiles,
  buildFileContext,
  callAnalysisAI,
  parseLLMJsonArray,
  type FileContextOptions,
} from '../toolHelpers';
import type { ToolHandler, ToolContext, ToolResult } from './types';
import type { SSEEvent } from '../../../shared/types';

export interface AnalysisToolConfig<TItem> {
  /** Options passed to buildFileContext */
  fileContextOptions: FileContextOptions;
  /** Build the AI prompt, with fileContext injected */
  buildPrompt: (fileContext: string) => string;
  /** Error label for parseLLMJsonArray failure */
  parseErrorLabel: string;
  /** Message when AI returns an empty array */
  emptyMessage: string;
  /** Optional pre-processing of parsed items (e.g. sort) */
  preProcess?: (items: TItem[]) => TItem[];
  /**
   * Persist items to DB, send SSE notification, and return summary string.
   * This is the only part that differs between tools.
   */
  persistAndNotify: (
    items: TItem[],
    caseId: string,
    drizzle: ReturnType<typeof getDB>,
    sendSSE: (event: SSEEvent) => Promise<void>,
  ) => Promise<string>;
}

/**
 * Create a ToolHandler from an AnalysisToolConfig.
 * Handles the entire common flow; each tool only provides its config.
 */
export const createAnalysisTool = <TItem>(config: AnalysisToolConfig<TItem>): ToolHandler => {
  return async (
    _args: Record<string, unknown>,
    caseId: string,
    db: D1Database,
    drizzle: ReturnType<typeof getDB>,
    ctx?: ToolContext,
  ): Promise<ToolResult> => {
    if (!ctx) {
      return toolError('Error: missing execution context');
    }

    // 1. Load all ready files
    let readyFiles;
    try {
      readyFiles = await loadReadyFiles(db, caseId);
    } catch (e) {
      return e as ToolResult;
    }

    // 2. Build context + prompt → call AI
    const fileContext = buildFileContext(readyFiles, config.fileContextOptions);
    const prompt = config.buildPrompt(fileContext);
    const responseText = await callAnalysisAI(ctx.aiEnv, prompt);

    // 3. Parse JSON array from response
    let items: TItem[];
    try {
      items = parseLLMJsonArray<TItem>(responseText, config.parseErrorLabel);
    } catch {
      return toolError(config.parseErrorLabel);
    }

    if (!items.length) {
      return { result: config.emptyMessage, success: false };
    }

    // 4. Optional pre-processing
    if (config.preProcess) {
      items = config.preProcess(items);
    }

    // 5. Persist to DB, send SSE, get summary
    const summary = await config.persistAndNotify(items, caseId, drizzle, ctx.sendSSE);

    return { result: summary, success: true };
  };
};
