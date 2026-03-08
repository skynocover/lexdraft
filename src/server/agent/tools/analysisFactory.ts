/**
 * Generic factory for analysis tools (disputes, damages, timeline).
 * All three follow the same flow:
 *   ctx check → loadReadyFiles → buildFileContext(enriched)
 *   → callGeminiNative(responseSchema, thinkingBudget:0, temperature:0)
 *   → JSON.parse → preProcess → persistAndNotify → return summary
 */
import type { getDB } from '../../db';
import {
  toolError,
  loadReadyFiles,
  buildFileContext,
  type FileContextOptions,
} from '../toolHelpers';
import { callGeminiNative } from '../aiClient';
import type { ToolHandler, ToolContext, ToolResult } from './types';
import type { SSEEvent } from '../../../shared/types';

const ANALYSIS_SYSTEM_PROMPT = '你是專業的台灣法律分析助手。';

export interface AnalysisToolConfig<TItem> {
  /** Options passed to buildFileContext (enriched defaults to true) */
  fileContextOptions?: FileContextOptions;
  /** Build the AI prompt, with fileContext injected */
  buildPrompt: (fileContext: string) => string;
  /** Gemini responseSchema for constrained decoding (OpenAPI format) */
  responseSchema: Record<string, unknown>;
  /** Error label for parse failure */
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

    // 2. Build context + prompt → call Gemini Native with constrained decoding
    const contextOptions: FileContextOptions = {
      enriched: true,
      ...config.fileContextOptions,
    };
    const fileContext = buildFileContext(readyFiles, contextOptions);
    const prompt = config.buildPrompt(fileContext);

    let content: string;
    try {
      const result = await callGeminiNative(ctx.aiEnv, ANALYSIS_SYSTEM_PROMPT, prompt, {
        maxTokens: 8192,
        responseSchema: config.responseSchema,
        temperature: 0,
        thinkingBudget: 0,
      });
      content = result.content;
    } catch (e) {
      console.error(`[analysisFactory] AI call failed:`, e);
      return toolError(config.parseErrorLabel);
    }

    // 3. Parse JSON (guaranteed valid by responseSchema)
    let items: TItem[];
    try {
      items = JSON.parse(content) as TItem[];
    } catch {
      console.error(
        `[analysisFactory] JSON parse failed (first 500 chars): ${content.slice(0, 500)}`,
      );
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
