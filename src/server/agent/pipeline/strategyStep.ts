import { callClaude, type ClaudeUsage } from '../claudeClient';
import { parseJsonField, repairTruncatedJson } from '../toolHelpers';
import { STRATEGIST_SYSTEM_PROMPT, buildStrategistInput } from '../prompts/strategistPrompt';
import {
  validateStrategyOutput,
  parseStrategyOutput,
  applyClaimDefaults,
} from './validateStrategy';
import type { StrategyOutput } from './types';
import type { PipelineContext } from '../briefPipeline';
import type { ContextStore } from '../contextStore';
import type { loadReadyFiles } from '../toolHelpers';
import type { AIEnv } from '../aiClient';
import type { TimelineItem, DamageItem } from './types';

// ── Step 3: 論證策略 helpers ──

export interface StrategyProgressCallback {
  onPrepareInput: () => Promise<void>;
  onLLMStart: (attempt: number) => Promise<void>;
  onLLMDone: () => Promise<void>;
  onValidateStart: () => Promise<void>;
  onValidateDone: (valid: boolean, errors?: string[]) => Promise<void>;
  onRetry: (attempt: number, reason: string) => Promise<void>;
}

export const callStrategist = async (
  ctx: PipelineContext,
  store: ContextStore,
  readyFiles: Awaited<ReturnType<typeof loadReadyFiles>>,
  damageList: DamageItem[],
  usage: ClaudeUsage,
  userAddedLaws: Array<{ id: string; law_name: string; article_no: string; content: string }>,
  timelineList: TimelineItem[] = [],
  progress?: StrategyProgressCallback,
): Promise<StrategyOutput> => {
  await progress?.onPrepareInput();

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
    damages: damageList,
    userAddedLaws,
    timeline: timelineList,
  });

  // First attempt
  let strategyOutput: StrategyOutput;
  try {
    await progress?.onLLMStart(1);
    strategyOutput = await callStrategyLLM(ctx.aiEnv, userMessage, usage);
    await progress?.onLLMDone();
  } catch (firstErr) {
    const errMsg = firstErr instanceof Error ? firstErr.message : '未知錯誤';
    const isTruncation = errMsg.includes('截斷');

    await progress?.onRetry(2, isTruncation ? '回應過長，精簡後重試' : 'JSON 格式修正');

    // Retry with appropriate correction prompt
    const correctionMessage = isTruncation
      ? userMessage +
        '\n\n═══ 修正指示 ═══\n' +
        '前一次輸出因長度超過限制而被截斷。請精簡輸出：\n' +
        '1. statement 欄位用一句話，不超過 30 字\n' +
        '2. fact_application 不超過 50 字\n' +
        '3. conclusion 不超過 20 字\n' +
        '4. 合併相似的 supporting claims\n' +
        '5. 只輸出合法 JSON，不要加 markdown code block'
      : userMessage +
        '\n\n═══ 修正指示 ═══\n前一次輸出不是有效的 JSON。請只輸出合法 JSON，不要加任何其他文字或 markdown code block。';
    try {
      await progress?.onLLMStart(2);
      strategyOutput = await callStrategyLLM(ctx.aiEnv, correctionMessage, usage);
      await progress?.onLLMDone();
    } catch {
      throw new Error(`論證策略規劃失敗：${errMsg}`);
    }
  }

  // Validate structure
  await progress?.onValidateStart();
  const validation = validateStrategyOutput(strategyOutput, store.legalIssues);
  await progress?.onValidateDone(
    validation.valid,
    validation.valid ? undefined : validation.errors,
  );

  if (!validation.valid) {
    // Retry with error injection — let LLM fix specific issues
    try {
      await progress?.onRetry(3, '結構驗證未通過，修正中');

      const retryMessage =
        userMessage +
        `\n\n═══ 修正指示 ═══\n你上一次的輸出有以下結構問題，請修正後重新輸出完整 JSON：\n` +
        validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n');

      await progress?.onLLMStart(3);
      strategyOutput = await callStrategyLLM(ctx.aiEnv, retryMessage, usage);
      await progress?.onLLMDone();

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
  const {
    content,
    usage: callUsage,
    truncated,
  } = await callClaude(aiEnv, STRATEGIST_SYSTEM_PROMPT, userMessage, 16384);
  usage.input_tokens += callUsage.input_tokens;
  usage.output_tokens += callUsage.output_tokens;

  // If response was truncated, try to repair the JSON before normal parsing
  if (truncated) {
    console.warn('[callStrategyLLM] Response truncated — attempting JSON repair');
    const repaired = repairTruncatedJson<StrategyOutput>(content);
    if (repaired && repaired.claims && repaired.sections) {
      console.warn(
        `[callStrategyLLM] JSON repair succeeded (${repaired.claims.length} claims, ${repaired.sections.length} sections)`,
      );
      repaired.claims = applyClaimDefaults(repaired.claims);
      return repaired;
    }
    throw new Error('論證策略回傳格式不正確（回應被截斷，JSON 不完整）');
  }

  return parseStrategyOutput(content);
};
