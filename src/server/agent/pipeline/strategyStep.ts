import { callClaude, type ClaudeUsage } from '../claudeClient';
import { parseJsonField } from '../toolHelpers';
import { STRATEGIST_SYSTEM_PROMPT, buildStrategistInput } from '../prompts/strategistPrompt';
import { validateStrategyOutput, parseStrategyOutput } from './validateStrategy';
import type { StrategyOutput } from './types';
import type { PipelineContext } from '../briefPipeline';
import type { ContextStore } from '../contextStore';
import type { loadReadyFiles } from '../toolHelpers';
import type { AIEnv } from '../aiClient';

// ── Step 3: 論證策略 helpers ──

export const callStrategist = async (
  ctx: PipelineContext,
  store: ContextStore,
  readyFiles: Awaited<ReturnType<typeof loadReadyFiles>>,
  damageList: Array<{
    id: string;
    category: string;
    description: string | null;
    amount: number;
  }>,
  usage: ClaudeUsage,
  userAddedLaws: Array<{ id: string; law_name: string; article_no: string; content: string }>,
): Promise<StrategyOutput> => {
  const fileSummaries = readyFiles.map((f) => {
    const summary = parseJsonField<Record<string, unknown>>(f.summary, {});
    return {
      id: f.id,
      filename: f.filename,
      category: f.category,
      summary: (summary.summary as string) || '無摘要',
    };
  });

  const userMessage = buildStrategistInput({
    caseSummary: store.caseSummary,
    briefType: store.briefType,
    caseMetadata: store.caseMetadata,
    legalIssues: store.legalIssues,
    research: store.research.map((r) => ({
      issue_id: r.issue_id,
      strength: r.strength,
      found_laws: r.found_laws.map((l) => ({
        id: l.id,
        law_name: l.law_name,
        article_no: l.article_no,
        content: l.content,
        side: l.side,
      })),
      analysis: r.analysis,
      attack_points: r.attack_points,
      defense_risks: r.defense_risks,
    })),
    informationGaps: store.informationGaps,
    fileSummaries,
    damages: damageList.map((d) => ({
      category: d.category,
      description: d.description,
      amount: d.amount,
    })),
    userAddedLaws,
  });

  // First attempt
  let strategyOutput: StrategyOutput;
  try {
    strategyOutput = await callStrategyLLM(ctx.aiEnv, userMessage, usage);
  } catch (firstErr) {
    // Retry once on parse failure — add correction prompt so LLM knows to fix JSON
    const correctionMessage =
      userMessage +
      '\n\n═══ 修正指示 ═══\n前一次輸出不是有效的 JSON。請只輸出合法 JSON，不要加任何其他文字或 markdown code block。';
    try {
      strategyOutput = await callStrategyLLM(ctx.aiEnv, correctionMessage, usage);
    } catch {
      throw new Error(
        `論證策略規劃失敗：${firstErr instanceof Error ? firstErr.message : '未知錯誤'}`,
      );
    }
  }

  // Validate structure
  const validation = validateStrategyOutput(strategyOutput, store.legalIssues);

  if (!validation.valid) {
    // Retry with error injection — let LLM fix specific issues
    try {
      const retryMessage =
        userMessage +
        `\n\n═══ 修正指示 ═══\n你上一次的輸出有以下結構問題，請修正後重新輸出完整 JSON：\n` +
        validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n');

      strategyOutput = await callStrategyLLM(ctx.aiEnv, retryMessage, usage);

      // Validate again — if still fails, use as-is
      const retryValidation = validateStrategyOutput(strategyOutput, store.legalIssues);
      if (!retryValidation.valid) {
        console.error('Strategy validation still failing after retry:', retryValidation.errors);
      }
    } catch (retryErr) {
      console.error('Strategy retry failed:', retryErr);
      // Use the first (imperfect) output rather than failing completely
    }
  }

  return strategyOutput;
};

const callStrategyLLM = async (
  aiEnv: AIEnv,
  userMessage: string,
  usage: ClaudeUsage,
): Promise<StrategyOutput> => {
  const { content, usage: callUsage } = await callClaude(
    aiEnv,
    STRATEGIST_SYSTEM_PROMPT,
    userMessage,
    8192, // Strategist output includes claims + sections — needs more tokens
  );
  usage.input_tokens += callUsage.input_tokens;
  usage.output_tokens += callUsage.output_tokens;

  return parseStrategyOutput(content);
};
