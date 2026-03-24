import { nanoid } from 'nanoid';
import { toolError, toolSuccess } from './toolHelpers';
import { ContextStore } from './contextStore';
import type { ToolResult } from './tools/types';
import type { Paragraph } from '../../client/stores/useBriefStore';
import type { PipelineStepChild } from '../../shared/types';
import { writeSection, cleanupUncitedLaws, getSectionKey } from './pipeline/writerStep';
import { fetchAndCacheUncitedMentions } from '../lib/lawRefService';
import { runLawFetch, truncateLawContent } from './pipeline/lawFetchStep';
import { renderTemplate } from './pipeline/templateRenderer';
import { formatEvidenceSection } from './pipeline/evidenceFormatter';
import {
  runReasoningStrategy,
  type ReasoningStrategyProgressCallback,
} from './pipeline/reasoningStrategyStep';
import { filterWritableSections } from './pipeline/templateHelper';
import {
  isItemDamage,
  type ReasoningStrategyInput,
  type ReasoningStrategyOutput,
  type PipelineContext,
} from './pipeline/types';
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
import { HEADER_SECTION, FOOTER_SECTION } from '../../shared/sectionConstants';
import {
  persistClaims,
  persistBriefContent,
  saveBriefVersion,
  persistExhibits,
} from './pipeline/pipelinePersistence';
import { buildChineseExhibitMap } from '../lib/exhibitAssign';
import { exhibits } from '../db/schema';
import { eq } from 'drizzle-orm';
import { FOCUS_DOC_MAX_LENGTH, FOCUS_DOC_MAX_COUNT } from './prompts/strategyConstants';
import type { BriefModeValue } from '../../shared/caseConstants';
import type { FileRow } from './pipeline/writerStep';

/** 根據 briefMode 從卷宗中提取焦點文件的 content_md（fallback full_text） */
const extractFocusDocuments = (
  briefMode: BriefModeValue | null,
  parsedFiles: Array<{ id: string; filename: string; category: string | null }>,
  fileContentMap: Map<string, FileRow>,
): ReasoningStrategyInput['focusDocuments'] => {
  if (!briefMode) return null;

  let targetCategories: string[];
  if (briefMode === 'supplement') {
    targetCategories = ['brief_theirs', 'brief']; // 'brief' = legacy fallback
  } else if (briefMode === 'challenge') {
    targetCategories = ['judgment'];
  } else {
    return null;
  }

  const docs: Array<{ filename: string; fileId: string; content: string }> = [];
  for (const f of parsedFiles) {
    if (!f.category || !targetCategories.includes(f.category)) continue;
    const full = fileContentMap.get(f.id);
    if (!full) continue;
    const raw = full.content_md || full.full_text || '';
    if (!/\S/.test(raw)) continue;
    const content =
      raw.length > FOCUS_DOC_MAX_LENGTH
        ? raw.slice(0, FOCUS_DOC_MAX_LENGTH) + `\n\n...（截斷，原文共 ${raw.length} 字）`
        : raw;
    docs.push({ filename: f.filename, fileId: f.id, content });
    if (docs.length >= FOCUS_DOC_MAX_COUNT) break;
  }

  return docs.length === 0 ? null : docs;
};

export type { PipelineContext } from './pipeline/types';

const makeParagraph = (idPrefix: string, section: string, contentMd: string): Paragraph => ({
  id: `${idPrefix}-${nanoid(8)}`,
  section,
  subsection: '',
  content_md: contentMd,
  dispute_id: null,
  citations: [],
});

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
      templateTitle: store.templateTitle,
      legalIssues: store.legalIssues,
      undisputedFacts: store.undisputedFacts,
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
      briefMode: ctx.briefMode,
      focusDocuments: extractFocusDocuments(ctx.briefMode, step0.parsedFiles, step0.fileContentMap),
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

    // ═══ Step 3: Writer (three-track: Flash Lite + AI writer + Code) ═══
    currentStep = STEP_WRITER;
    await progress.startStep(STEP_WRITER);

    const sendParagraphSSE = async (p: Paragraph) => {
      await ctx.sendSSE({
        type: 'brief_update',
        brief_id: step0.briefId,
        action: 'add_paragraph',
        data: p,
      });
    };

    // ── Track 1: Flash Lite renders header + template sections + footer ──
    let headerParagraph: Paragraph | null = null;
    const templateSectionParagraphs: Paragraph[] = [];
    let footerParagraph: Paragraph | null = null;
    if (step0.templateContentMd) {
      try {
        // Filter out "總計/合計" rows when computing damages total
        const itemDamages = store.damages.filter(isItemDamage);

        const rendered = await renderTemplate(
          ctx.aiEnv,
          step0.templateContentMd,
          {
            plaintiff: store.parties.plaintiff || null,
            defendant: store.parties.defendant || null,
            caseNumber: store.caseMetadata.caseNumber || null,
            court: store.caseMetadata.court || null,
            division: store.caseMetadata.division || null,
            clientRole: store.caseMetadata.clientRole || null,
            damageItems: itemDamages,
          },
          ctx.signal,
        );

        if (rendered.header) {
          // Remove first line (document type name) — already shown by .a4-title
          const headerLines = rendered.header.split('\n');
          const headerContent = headerLines.slice(1).join('\n').trim();
          if (headerContent) {
            headerParagraph = makeParagraph('header', HEADER_SECTION, headerContent);
            await sendParagraphSSE(headerParagraph);
          }
        }
        for (const sec of rendered.sections) {
          const p = makeParagraph('tpl', sec.heading, sec.content);
          templateSectionParagraphs.push(p);
          await sendParagraphSSE(p);
        }
        if (rendered.footer) {
          footerParagraph = makeParagraph('footer', FOOTER_SECTION, rendered.footer);
          // Footer SSE sent after writer loop completes
        }
      } catch (err) {
        console.error('[pipeline] Flash Lite rendering failed:', err);
      }
    }

    // ── Load exhibit mapping for writer prompt injection ──
    const exhibitRows = await ctx.drizzle
      .select({
        file_id: exhibits.file_id,
        prefix: exhibits.prefix,
        number: exhibits.number,
      })
      .from(exhibits)
      .where(eq(exhibits.case_id, ctx.caseId));
    const chineseExhibitMap = buildChineseExhibitMap(exhibitRows);

    // ── Track 2: AI writer loop ──
    // NOTE: must mutate store.sections because getContextForSection(i) indexes into it
    const renderedHeadings = new Set(templateSectionParagraphs.map((p) => p.section));
    store.sections = filterWritableSections(store.sections, renderedHeadings);

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
          chineseExhibitMap,
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

    await progress.completeWriting(paragraphs.length);

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

    // ═══ Persist exhibits first, then format evidence section from them ═══
    await cleanupUncitedLaws(ctx, paragraphs);

    // Auto-assign exhibit numbers for cited files
    await persistExhibits(
      ctx,
      paragraphs,
      store.caseMetadata.clientRole,
      step0.parsedFiles.map((f) => ({
        id: f.id,
        filename: f.filename,
        category: f.category,
        summary: f.parsedSummary,
      })),
    );

    // ── Evidence section (after exhibits are assigned) ──
    let evidenceParagraph: Paragraph | null = null;
    try {
      const evidenceText = await formatEvidenceSection(ctx.drizzle, ctx.caseId);
      if (evidenceText) {
        evidenceParagraph = makeParagraph('evidence', '證據方法', evidenceText);
        await sendParagraphSSE(evidenceParagraph);
      }
    } catch (err) {
      console.error('[pipeline] Evidence formatting failed:', err);
    }

    // Send footer SSE after evidence (correct visual order)
    if (footerParagraph) {
      await sendParagraphSSE(footerParagraph);
    }

    // Assemble in order: header → template sections → AI content → evidence → footer
    const allParagraphs = [
      ...(headerParagraph ? [headerParagraph] : []),
      ...templateSectionParagraphs,
      ...paragraphs,
      ...(evidenceParagraph ? [evidenceParagraph] : []),
      ...(footerParagraph ? [footerParagraph] : []),
    ];

    await emitSnapshot('step3', {
      store: store.serialize(),
      paragraphs: allParagraphs,
      qualityReport: buildQualityReport(paragraphs),
    });

    // ═══ Persist: brief content + version snapshot ═══
    await persistBriefContent(ctx, step0.briefId, allParagraphs);
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
