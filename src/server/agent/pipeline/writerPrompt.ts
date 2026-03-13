// ── Writer Prompt Builder ──
// Assembles the instruction prompt for Step 3 Writer (both content + intro/conclusion sections).
// Extracted from writerStep.ts for readability — writerStep.ts handles AI calls + post-processing.

import { buildCaseMetaLines } from '../prompts/promptHelpers';
import { isDefenseTemplate } from '../prompts/strategyConstants';
import {
  formatDamageAmount,
  getSectionKey,
  isContentSection,
  isItemDamage,
  type StrategySection,
  type WriterContext,
} from './types';
import type { ClaudeDocument } from '../claudeClient';
import type { ContextStore } from '../contextStore';

// ── Prompt Input ──

export interface WriterPromptInput {
  templateId: string | null;
  strategySection: StrategySection;
  writerCtx: WriterContext;
  documents: ClaudeDocument[];
  store: ContextStore;
  exhibitMap?: Map<string, string>;
}

// ── Main Builder ──

export const buildWriterInstruction = (input: WriterPromptInput): string => {
  const { templateId, strategySection, writerCtx, documents, store, exhibitMap } = input;

  // ── Context blocks ──
  const outlineText = buildOutlineBlock(writerCtx);
  const claimsText = buildClaimsBlock(writerCtx, store);
  const argText = writerCtx.argumentation;
  const legalBasisText =
    argText.legal_basis.length > 0 ? `法律依據：${argText.legal_basis.join('、')}` : '';
  const factsText = buildFactsBlock(writerCtx);
  const completedText = buildCompletedBlock(writerCtx, store);
  const docListText = buildDocListBlock(
    documents,
    isContentSection(strategySection) ? exhibitMap : undefined,
  );

  const meta = store.caseMetadata;
  const caseMetaLines = buildCaseMetaLines(meta, '  ').join('\n');
  const instructionsLine = meta.caseInstructions
    ? `\n  律師處理指引：${meta.caseInstructions}`
    : '';

  // ── Assemble instruction ──
  let instruction = `你是台灣資深訴訟律師。請根據提供的來源文件撰寫法律書狀段落。

[書狀全局資訊]
  書狀名稱：${writerCtx.templateTitle}${caseMetaLines ? '\n' + caseMetaLines : ''}${instructionsLine}
  完整大綱：
${outlineText}${docListText}

[本段負責的 Claims]
${claimsText}

[本段論證結構]${legalBasisText ? `\n  ${legalBasisText}` : ''}
  事實適用：${argText.fact_application}
  結論：${argText.conclusion}`;

  if (writerCtx.legal_reasoning) {
    instruction += `

[本段推理指引]（律師的推理方向，指導撰寫深度）
  ${writerCtx.legal_reasoning}`;
  }

  if (factsText) {
    instruction += `

[事實運用]
${factsText}`;
  }

  const dispute = strategySection.dispute_id
    ? store.legalIssues.find((d) => d.id === strategySection.dispute_id)
    : null;

  if (dispute) {
    instruction += `

[爭點資訊]
  爭點：${dispute.title}
  我方立場：${dispute.our_position}
  對方立場：${dispute.their_position}`;
  }

  if (completedText) {
    instruction += `

[已完成段落]（維持前後文一致性）
${completedText}`;
  }

  instruction += COMMON_WRITING_RULES;

  if (isDefenseTemplate(templateId)) {
    instruction += DEFENSE_WRITING_RULES;
  }

  if (isContentSection(strategySection) && exhibitMap && exhibitMap.size > 0) {
    instruction += EXHIBIT_RULES;
  }

  if (!isContentSection(strategySection)) {
    instruction += buildIntroOrConclusionBlock(strategySection, store);
  }

  return instruction;
};

// ── Block Builders ──

const buildOutlineBlock = (writerCtx: WriterContext): string =>
  writerCtx.fullOutline
    .map((o) => {
      const label = o.subsection ? `${o.section} > ${o.subsection}` : o.section;
      return o.isCurrent ? `  【你正在寫這段】${label}` : `  ${label}`;
    })
    .join('\n');

const buildClaimsBlock = (writerCtx: WriterContext, store: ContextStore): string => {
  const typeLabels: Record<string, string> = {
    primary: '主要主張',
    rebuttal: '反駁',
    supporting: '輔助',
  };

  if (writerCtx.claims.length === 0) return '（無特定主張）';

  return writerCtx.claims
    .map((c) => {
      const sideLabel = c.side === 'ours' ? '我方' : '對方';
      const typeLabel = typeLabels[c.claim_type] || '主要主張';
      let line = `  ${c.id}: ${c.statement}（${sideLabel}｜${typeLabel}）`;
      if (c.responds_to) {
        const target = store.claims.find((t) => t.id === c.responds_to);
        if (target) line += `\n    → 回應：${target.id}「${target.statement.slice(0, 50)}」`;
      }
      return line;
    })
    .join('\n');
};

const buildFactsBlock = (writerCtx: WriterContext): string => {
  if (!writerCtx.factsToUse || writerCtx.factsToUse.length === 0) return '';
  return writerCtx.factsToUse.map((f) => `  - ${f.fact_id}：${f.usage}`).join('\n');
};

const buildCompletedBlock = (writerCtx: WriterContext, store: ContextStore): string => {
  if (writerCtx.completedSections.length === 0) return '';
  return writerCtx.completedSections
    .map((d) => {
      const sec = store.sections.find((s) => s.id === d.section_id);
      const label = sec ? getSectionKey(sec.section, sec.subsection) : d.section_id;
      return `【${label}】\n${d.content}`;
    })
    .join('\n\n');
};

const buildDocListBlock = (
  documents: ClaudeDocument[],
  exhibitMap?: Map<string, string>,
): string => {
  const fileDocs: ClaudeDocument[] = [];
  const lawDocNames: string[] = [];
  for (const d of documents) {
    if (d.doc_type === 'file') fileDocs.push(d);
    else if (d.doc_type === 'law') lawDocNames.push(d.title);
  }

  const docLines: string[] = [];
  if (fileDocs.length > 0) {
    if (exhibitMap && exhibitMap.size > 0) {
      const fileLines = fileDocs.map((d) => {
        const exhibitLabel = d.file_id ? exhibitMap.get(d.file_id) : undefined;
        return exhibitLabel ? `  「${d.title}」（${exhibitLabel}）` : `  「${d.title}」`;
      });
      docLines.push(`  案件文件：\n${fileLines.join('\n')}`);
    } else {
      docLines.push(`  案件文件：${fileDocs.map((d) => `「${d.title}」`).join('、')}`);
    }
  }
  if (lawDocNames.length > 0) {
    docLines.push(`  法條文件：${lawDocNames.map((n) => `「${n}」`).join('、')}`);
  }

  return docLines.length > 0
    ? `\n\n[提供的來源文件]（你必須從這些文件中引用）\n${docLines.join('\n')}`
    : '';
};

const buildIntroOrConclusionBlock = (
  strategySection: StrategySection,
  store: ContextStore,
): string => {
  const isIntro = strategySection.section.includes('前言');

  const damagesLines = store.damages
    .filter((d) => d.amount > 0 && isItemDamage(d))
    .map((d) => `  ${formatDamageAmount(d)}`)
    .join('\n');
  const totalDamage = store.damages.find((d) => d.description?.includes('總計'));

  const issueLines = store.legalIssues.map((li) => `  - ${li.title}`).join('\n');

  return `

[案件事實摘要]（以下資訊已從案件文件中確認，你必須嚴格依照這些事實撰寫，不得修改任何日期、姓名、數字或傷勢描述）
${store.caseSummary}

[爭點列表]
${issueLines}

[賠償項目]
${damagesLines}
  合計：新臺幣${totalDamage ? totalDamage.amount.toLocaleString() : ''}元

[本段撰寫範圍]（此規則優先於上方通用規則）
${
  isIntro
    ? `- 前言僅需概述案件背景（當事人、事故經過梗概、責任認定結果）與本狀訴訟目的
- 不要論述個別損害項目的具體金額或計算方式（那是後續段落的工作）
- 段落長度控制在 150-300 字`
    : `- 結論需總結上述論述要旨，提出具體請求總金額，懇請法院判決
- 段落長度控制在 150-300 字`
}`;
};

// ── Rule Blocks (static strings) ──

const COMMON_WRITING_RULES = `

[撰寫規則]
- 使用正式法律文書用語（繁體中文）
- 依照論證結構和 claims 列表撰寫，確保每個 claim 都有論述
- 引用法條時，務必從提供的法條文件中引用，讓系統能自動標記引用來源
- 引用事實時，務必從提供的來源文件中直接引用對應段落
- 每當提及具體數字（金額、日期、天數、次數）時，必須引用記載該數字的來源文件
- 每當提及醫療診斷、鑑定結論、證明文件內容時，必須引用對應文件
- 對「承認」的事實，可使用「此為兩造所不爭執」等用語
- 對「爭執」的事實，需提出證據佐證
- 對「自認」的事實，使用「被告於答辯狀自承」等用語
- 對 rebuttal claim（反駁），需明確引用並反駁對方主張
- 對 supporting claim（輔助），需與同段落的主要主張呼應
- 絕對不要輸出任何 XML 標籤（如 <document_context> 等）
- 絕對不要使用 emoji 或特殊符號
- 絕對不要在書狀中提及「論證結構」「來源文件」「提供的文件」等內部指令術語，直接以律師口吻撰寫
- 直接撰寫段落內容，不需要加入章節標題
- 絕對不要使用 markdown 語法（包括 #、>、**、* 等標記），輸出純文字段落
- 段落長度控制在 150-400 字之間
- 如遇不確定或需律師確認的資訊（如送達日期、當事人地址、身分證字號、具體證物編號），使用【待填：說明】標記，例如【待填：起訴狀繕本送達翌日】、【待填：原告住址】
- 每段的論述角度和句式必須有所區分。參考[已完成段落]，避免重複使用相同的開頭句式（如不要每段都以「原告請求…悉數應予准許」開頭）、相同的法條引用模式、或相同的結尾語式
- 每個損害項目有不同的法律依據和舉證重點，撰寫時應突出該項目的獨特論點，而非套用通用模板`;

const DEFENSE_WRITING_RULES = `

[答辯狀撰寫規則]（優先於上方通用規則）
- 本書狀為答辯狀，語氣應為防禦 + 反擊，而非主動攻擊
- 每個內容段落應以回應原告主張為主軸，使用「原告主張…惟查…」或「原告雖稱…然查…」的反駁句式
- 先簡述原告的主張（1-2句），再展開反駁論述
- 反駁時應指出原告舉證的不足或矛盾，而非僅陳述我方立場
- 善用舉證責任分配：「依民事訴訟法第277條，此部分事實應由原告負舉證責任」
- 引用我方證據反駁時，同時指出原告證據的漏洞
- 積極抗辯段落（過失相抵、時效等）使用主動語氣，明確主張法律效果
- 對「自認」的事實，使用「原告於起訴狀自承」等用語`;

const EXHIBIT_RULES = `
- 引用案件文件時，必須在文件通稱後附加證物編號，格式範例：「有鑑定意見書可稽（甲證一）」「有診斷證明書附卷可參（甲證二）」「此有薪資證明為證（甲證三）」
- 同一段落再次引用同一文件時，可直接使用證物編號（如「甲證一」），不需重複文件通稱`;
