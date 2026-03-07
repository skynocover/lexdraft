import { toolError, toolSuccess } from './toolHelpers';
import { ContextStore } from './contextStore';
import type { ToolResult } from './tools/types';
import type { Paragraph } from '../../client/stores/useBriefStore';
import type { PipelineStepChild } from '../../shared/types';
import { writeSection, cleanupUncitedLaws, getSectionKey } from './pipeline/writerStep';
import { fetchAndCacheUncitedMentions } from '../lib/lawRefService';
import { runLawFetch, truncateLawContent } from './pipeline/lawFetchStep';
import { assembleHeader, assembleDeclaration, assembleFooter } from './pipeline/briefAssembler';
import {
  runReasoningStrategy,
  type ReasoningStrategyProgressCallback,
} from './pipeline/reasoningStrategyStep';
import type {
  ReasoningStrategyInput,
  ReasoningStrategyOutput,
  PipelineContext,
} from './pipeline/types';
import type { LawRefItem } from '../lib/lawRefsJson';
import { runCaseAnalysis } from './pipeline/caseAnalysisStep';
import { buildQualityReport } from './pipeline/qualityReport';
import { mapToJson } from './pipeline/snapshotUtils';
import {
  createProgressTracker,
  STEP_CASE,
  STEP_LAW,
  STEP_STRATEGY,
  STEP_WRITER,
} from './pipeline/pipelineProgress';
import {
  persistClaims,
  persistBriefContent,
  saveBriefVersion,
  persistLawRefs,
} from './pipeline/pipelinePersistence';

export type { PipelineContext } from './pipeline/types';

export interface PipelineOptions {
  onStepComplete?: (stepName: string, data: unknown) => void | Promise<void>;
}

// ── Main Pipeline ──

export const runBriefPipeline = async (
  ctx: PipelineContext,
  opts?: PipelineOptions,
): Promise<ToolResult> => {
  const pipelineStartTime = Date.now();
  const failedSections: string[] = [];
  const store = new ContextStore();
  const progress = createProgressTracker(ctx.sendSSE);
  let currentStep = STEP_CASE;

  const emitSnapshot = async (stepName: string, data: unknown) => {
    if (!opts?.onStepComplete) return;
    try {
      await opts.onStepComplete(stepName, data);
    } catch (e) {
      console.warn(`[pipeline] onStepComplete(${stepName}) failed:`, e);
    }
  };

  try {
    // ═══ Step 0: Case Analysis ═══
    if (ctx.signal.aborted) return toolError('已取消');
    await progress.startStep(STEP_CASE);

    const step0 = await runCaseAnalysis(ctx, store, {
      setChildren: (children) => progress.setStepChildren(STEP_CASE, children),
    });

    await progress.completeStep(STEP_CASE, step0.stepDetail, step0.stepContent);

    // Identify user-added laws (is_manual = true)
    const userAddedLaws = step0.allLawRefRows
      .filter((r) => r.is_manual && r.full_text)
      .map((r) => ({
        id: r.id,
        law_name: r.law_name,
        article_no: r.article,
        content: r.full_text,
      }));

    await emitSnapshot('step0', {
      store: store.serialize(),
      briefId: step0.briefId,
      parsedFiles: step0.parsedFiles,
      allLawRefRows: step0.allLawRefRows,
      templateContentMd: step0.templateContentMd,
      fileContentMap: mapToJson(step0.fileContentMap),
    });

    // ═══ Step 1: Law Fetch (pure function, no AI) ═══
    if (ctx.signal.aborted) return toolError('已取消');
    currentStep = STEP_LAW;
    await progress.startStep(STEP_LAW);

    const lawFetchChildren: PipelineStepChild[] = [];

    const lawFetchResult = await runLawFetch(
      ctx.mongoUrl,
      {
        legalIssues: store.legalIssues,
        userAddedLaws: step0.allLawRefRows.filter((r) => r.is_manual),
        existingLawRefs: step0.allLawRefRows,
      },
      ctx.mongoApiKey,
    );

    const fetchedLawsArray = [...lawFetchResult.laws.values()];

    // Build progress children showing actual law names
    const mentionedLaws = fetchedLawsArray.filter((l) => l.source === 'mentioned');
    const manualLaws = fetchedLawsArray.filter((l) => l.source === 'user_manual');

    if (mentionedLaws.length > 0) {
      lawFetchChildren.push({
        label: '提及法條',
        status: 'done',
        detail: `${mentionedLaws.length} 條`,
        results: mentionedLaws.map((l) => `${l.law_name} ${l.article_no}`),
      });
    }
    if (manualLaws.length > 0) {
      lawFetchChildren.push({
        label: '使用者手動法條',
        status: 'done',
        detail: `${manualLaws.length} 條`,
        results: manualLaws.map((l) => `${l.law_name} ${l.article_no}`),
      });
    }
    await progress.setStepChildren(STEP_LAW, [...lawFetchChildren]);

    // Cache fetched laws in DB
    const lawRefsToCache: LawRefItem[] = mentionedLaws.map((l) => ({
      id: l.id,
      law_name: l.law_name,
      article: l.article_no,
      full_text: l.content,
      is_manual: false,
    }));
    await persistLawRefs(ctx, lawRefsToCache);

    await progress.completeStep(STEP_LAW, `${lawFetchResult.total} 條法條`);

    await emitSnapshot('step1', {
      store: store.serialize(),
      fetchedLawsArray,
      userAddedLaws,
    });

    // ═══ Step 2: Reasoning + Strategy (Claude tool-loop) ═══
    if (ctx.signal.aborted) return toolError('已取消');
    currentStep = STEP_STRATEGY;
    await progress.startStep(STEP_STRATEGY);

    const strategyChildren: PipelineStepChild[] = [];
    const strategyProgress: ReasoningStrategyProgressCallback = {
      onReasoningStart: async () => {
        strategyChildren.push({ label: 'AI 法律推理中', status: 'running' });
        await progress.setStepChildren(STEP_STRATEGY, [...strategyChildren]);
      },
      onSearchLaw: async (query, purpose, resultCount, lawNames) => {
        strategyChildren.push({
          label: `補搜：${purpose}`,
          status: 'done',
          detail: resultCount > 0 ? `${resultCount} 條（${query}）` : `未找到（${query}）`,
          results: lawNames.length > 0 ? lawNames : undefined,
        });
        await progress.setStepChildren(STEP_STRATEGY, [...strategyChildren]);
      },
      onFinalized: async () => {
        const idx = strategyChildren.findIndex(
          (c) => c.label === 'AI 法律推理中' && c.status === 'running',
        );
        if (idx >= 0) {
          strategyChildren[idx] = { ...strategyChildren[idx], status: 'done' };
        }
        strategyChildren.push({ label: '推理完成，輸出策略', status: 'running' });
        await progress.setStepChildren(STEP_STRATEGY, [...strategyChildren]);
      },
      onOutputStart: async () => {
        const idx = strategyChildren.findLastIndex((c) => c.status === 'running');
        if (idx >= 0) {
          strategyChildren[idx] = { ...strategyChildren[idx], status: 'done' };
          await progress.setStepChildren(STEP_STRATEGY, [...strategyChildren]);
        }
      },
    };

    const strategyInput: ReasoningStrategyInput = {
      caseSummary: store.caseSummary,
      briefType: store.briefType,
      legalIssues: store.legalIssues,
      informationGaps: store.informationGaps,
      fetchedLaws: fetchedLawsArray
        .filter((l) => l.source !== 'user_manual')
        .map(truncateLawContent),
      fileSummaries: step0.parsedFiles.map((f) => ({
        id: f.id,
        filename: f.filename,
        category: f.category,
        summary: f.parsedSummary || '無摘要',
      })),
      damages: store.damages,
      timeline: store.timeline,
      userAddedLaws,
      caseMetadata: store.caseMetadata,
    };

    const strategyOutput: ReasoningStrategyOutput = await runReasoningStrategy(
      ctx,
      store,
      strategyInput,
      strategyProgress,
      step0.templateContentMd,
    );

    // Set found laws in ContextStore (fetchedLaws + supplementedLaws)
    store.setFoundLaws(fetchedLawsArray);

    // Set strategy in ContextStore
    store.setStrategyOutput(strategyOutput.claims, strategyOutput.sections);

    // Persist claims to DB + notify frontend
    await persistClaims(ctx, strategyOutput.claims);

    const ourClaimCount = strategyOutput.claims.filter((c) => c.side === 'ours').length;
    const theirClaimCount = strategyOutput.claims.filter((c) => c.side === 'theirs').length;
    const rebuttalCount = strategyOutput.claims.filter((c) => c.claim_type === 'rebuttal').length;
    const unrebutted = store.getUnrebutted().length;
    await progress.completeStep(
      STEP_STRATEGY,
      `${strategyOutput.sections.length} 段、${ourClaimCount} 項我方主張、${theirClaimCount} 項對方主張`,
      {
        type: 'strategy',
        sections: strategyOutput.sections.map((s) => {
          const sectionClaims = strategyOutput.claims
            .filter((c) => s.claims.includes(c.id))
            .map((c) => ({
              side: c.side as 'ours' | 'theirs',
              statement: c.statement,
            }));
          return {
            id: s.id,
            section: s.section,
            subsection: s.subsection,
            claimCount: s.claims.length,
            claims: sectionClaims,
          };
        }),
        claimCount: strategyOutput.claims.length,
        rebuttalCount,
        unrebutted,
      },
    );

    await emitSnapshot('step2', {
      store: store.serialize(),
      strategyInput,
      strategyOutput,
    });

    // ═══ Step 3: Writer (sequential, uses strategy sections) ═══
    currentStep = STEP_WRITER;
    await progress.startStep(STEP_WRITER);

    // ── Assemble header + declaration BEFORE writer loop ──
    const caseRowForAssembly = {
      court: store.caseMetadata.court || null,
      case_number: store.caseMetadata.caseNumber || null,
      plaintiff: store.parties.plaintiff || null,
      defendant: store.parties.defendant || null,
      client_role: store.caseMetadata.clientRole || null,
    };
    const headerParagraphs = assembleHeader(ctx.briefType, caseRowForAssembly);
    const declarationParagraphs = assembleDeclaration(ctx.briefType, store.damages);

    const sendParagraphSSE = async (p: Paragraph) => {
      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: step0.briefId,
        action: 'add_paragraph',
        data: p,
      });
    };

    for (const p of headerParagraphs) await sendParagraphSSE(p);
    for (const p of declarationParagraphs) await sendParagraphSSE(p);

    // ── AI writer loop ──
    const paragraphs: Paragraph[] = [];

    for (let i = 0; i < store.sections.length; i++) {
      if (ctx.signal.aborted) break;

      const strategySection = store.sections[i];
      const sectionKey = getSectionKey(strategySection.section, strategySection.subsection);

      await progress.updateWriting(i + 1, store.sections.length, sectionKey);

      try {
        const writerCtx = store.getContextForSection(i);

        const paragraph = await writeSection(
          ctx,
          step0.briefId,
          strategySection,
          writerCtx,
          step0.fileContentMap,
          store,
        );

        paragraphs.push(paragraph);

        // Record in ContextStore for subsequent sections' review layer
        store.addDraftSection({
          paragraph_id: paragraph.id,
          section_id: strategySection.id,
          content: paragraph.content_md,
          segments: paragraph.segments || [],
          citations: paragraph.citations,
        });
      } catch (err) {
        console.error(`Writer failed for section "${sectionKey}":`, err);
        failedSections.push(sectionKey);
      }
    }

    // ── Assemble footer AFTER writer loop ──
    const footerParagraphs = assembleFooter(ctx.briefType, caseRowForAssembly);
    for (const p of footerParagraphs) await sendParagraphSSE(p);

    await progress.completeWriting(paragraphs.length);

    const allParagraphs = [
      ...headerParagraphs,
      ...declarationParagraphs,
      ...paragraphs,
      ...footerParagraphs,
    ];

    // ═══ Batch: detect uncited law mentions across all paragraphs at once ═══
    if (paragraphs.length > 0) {
      const fullText = paragraphs.map((p) => p.content_md).join('\n');
      const citedLawLabels = new Set<string>();
      for (const p of paragraphs) {
        for (const c of p.citations) {
          if (c.type === 'law') citedLawLabels.add(c.label);
        }
      }

      await fetchAndCacheUncitedMentions(
        ctx.drizzle,
        ctx.caseId,
        ctx.mongoUrl,
        fullText,
        citedLawLabels,
      );
    }

    await emitSnapshot('step3', {
      store: store.serialize(),
      paragraphs: allParagraphs,
      qualityReport: buildQualityReport(paragraphs),
    });

    // ═══ Persist: brief content + version snapshot + cleanup ═══
    await persistBriefContent(ctx, step0.briefId, allParagraphs);
    await cleanupUncitedLaws(ctx, paragraphs);
    await saveBriefVersion(ctx, step0.briefId, allParagraphs);

    // Report pipeline timing
    await ctx.sendSSE({
      type: 'pipeline_timing',
      totalDurationMs: Date.now() - pipelineStartTime,
    });

    let resultMsg = `已完成書狀撰寫，共 ${allParagraphs.length} 個段落。`;
    if (strategyOutput.claims.length > 0) {
      resultMsg += `\n論證策略：${ourClaimCount} 項我方主張、${theirClaimCount} 項對方主張。`;
    }
    if (failedSections.length) {
      resultMsg += `\n以下段落撰寫失敗：${failedSections.join('、')}`;
    }
    if (ctx.signal.aborted) {
      resultMsg += `\n（已取消，保留已完成的 ${paragraphs.length} 個段落）`;
    }

    return toolSuccess(resultMsg);
  } catch (err) {
    // loadReadyFiles throws a ToolResult when no files are ready — propagate it
    if (err && typeof err === 'object' && 'result' in err) return err as unknown as ToolResult;

    const errMsg = err instanceof Error ? err.message : '未知錯誤';
    // Mark whichever step was running as error so the UI shows the cause
    try {
      await progress.failStep(currentStep, errMsg);
    } catch {
      /* ignore SSE send failures during error handling */
    }
    return toolError(`Pipeline 執行失敗：${errMsg}`);
  }
};
