// ── Step 2: 法律推理 + 論證策略 — System Prompt ──

import { buildCaseMetaLines, buildInstructionsBlock } from './promptHelpers';
import {
  WRITING_CONVENTIONS,
  getClaimsRules,
  getSectionRules,
  getJsonSchema,
  type PipelineMode,
} from './strategyConstants';
import { FALLBACK_GUIDANCE } from '../../lib/defaultTemplates';
import { getCaseTypeGuidance } from './caseTypeKnowledge';
import { getDamageLabel, type ReasoningStrategyInput } from '../pipeline/types';
import { truncateText } from '../../lib/jsonUtils';
import type { BriefModeValue } from '../../../shared/caseConstants';

// ── 起訴狀推理工作流程 ──
const COMPLAINT_REASONING_WORKFLOW = `
### Reasoning 階段：法律推理（自由使用文字思考）

1. **請求權基礎分析**
   - 檢視每個爭點可用的請求權基礎
   - 比較不同基礎的優劣（舉證責任、構成要件難易度、法律效果）
   - 決定主要主張（primary）和備位主張（如有必要）
   - 說明為什麼選這個基礎、為什麼不選其他的

2. **構成要件涵攝（逐要件拆解）**
   - 列出選定請求權基礎的每一個構成要件
   - 逐一將案件事實涵攝到各要件中，引用具體數字、日期、金額
   - 涵攝格式：要件名稱 → 對應事實 → 小結論
   - 例如：「過失要件 → 被告左轉未讓直行車先行，違反道交§102(1)(7) → 構成過失」
   - 標記哪些要件有充分證據、哪些是弱點
   - 如果某要件缺乏證據，考慮：
     - 能否用其他請求權基礎避開？
     - 能否用法律推定轉移舉證責任？
     - 還是必須承認這是弱點，用保守措辭處理？

3. **攻防預判（具體反駁策略）**
   - 站在對方律師角度，預測可能的具體抗辯（不要只說「金額過高」，要具體指出對方可能主張的替代金額或計算方式）
   - 為每個預測的抗辯準備具體反駁：
     a. 引用案件中的具體數字（日期、天數、金額）來反駁
     b. 區分概念差異（如「醫囑最低休養期」vs「完全恢復職業能力所需時間」）
     c. 如有可能，提供類案判決的合理金額區間作為參考
     d. 論述職業特殊性對損害程度的影響（如有）
   - 如果預判需要額外法條（如時效抗辯相關條文）-> 呼叫 search_law 補搜
   - 對每個預判的抗辯，評估是否需要在書狀中安排獨立段落回應（而非只在其他段落順帶提及）`;

// ── 答辯狀推理工作流程（三層框架） ──
const DEFENSE_REASONING_WORKFLOW = `
### Reasoning 階段：法律推理（自由使用文字思考）

你是被告方律師，正在撰寫答辯狀。你的任務是逐一回應原告的主張。案件檔案中包含原告的起訴狀或書狀，請仔細閱讀並識別原告的每一項主張。

1. **解構原告主張（逐點分類）**
   - 從案件檔案（特別是分類為「書狀」的檔案）中識別原告的每一個具體主張
   - 對每個主張做分類判斷：
     a. 「事實否認」：原告主張的事實不實（如：否認闖紅燈、否認有過失行為）
     b. 「法律爭執」：事實可能成立但法律適用有誤（如：承認碰撞但爭執過失比例、不構成侵權）
     c. 「金額爭執」：責任成立但金額計算有誤（如：醫療費部分與事故無因果關係）
     d. 「全部承認」：不爭執的部分，簡短帶過
   - 每個分類必須附上分類理由和初步反駁方向

2. **防禦策略（找出原告舉證弱點）**
   - 對每個「事實否認」和「法律爭執」的主張：
     a. 分析舉證責任歸屬：哪些事實依法應由原告舉證？原告是否已充分舉證？
     b. 找出原告證據的漏洞或矛盾（如：原告主張闖紅燈但未提出號誌錄影）
     c. 列出我方可用的反證（從案件檔案中找出支持我方的證據）
     d. 引用具體數字、日期、金額來反駁
   - 對每個「金額爭執」的主張：
     a. 逐項核算原告的金額主張
     b. 指出不合理的部分（如：自費項目與事故無因果關係、計算基礎錯誤）
     c. 提出合理的金額估算

3. **積極抗辯（主動攻擊）**
   - 檢查是否有可用的積極防禦事由：
     a. 過失相抵（§217）：原告是否與有過失？（如未繫安全帶、未遵守交通規則）
     b. 損益相抵：原告是否已從保險或其他來源獲得補償？
     c. 時效抗辯（§197）：原告的請求權是否已罹於時效？
     d. 其他法定抗辯事由
   - 如有積極抗辯，規劃為獨立段落（放在回應段落之後、結論之前）`;

// ── 共用部分 ──
const COMMON_SEARCH_INSTRUCTIONS = `
4. **補充搜尋**
   - 審視推理過程中提到但尚未查閱全文的法條，主動搜尋
   - 當你引用某條文作為請求權基礎時，也應搜尋相關的配套條文（例如引用 §184 侵權行為時，應補搜損害賠償範圍、過失相抵、特殊侵權類型等相關條文）
   - 每次推理中至少進行 2-3 次搜尋，確保論證所需的法條都有全文依據
   - search_law 關鍵字格式：「法規名 概念」（中間加空格）
   - 搜尋範例：
     - 「民法 損害賠償」→ 找到 §213, §216 等
     - 「民法 動力車輛」→ 找到 §191-2
     - 「民法 慰撫金」→ 找到 §195
     - 「民法 過失相抵」→ 找到 §217
   - 避免不帶法規名的純概念搜尋（如「損害賠償請求時效」），否則會搜到不相關的法規
   - 搜不到時拆短重搜，不要加長
   - 每次搜尋必須附上 purpose

5. **完整性檢查（finalize 前必做）**
   - 在呼叫 finalize_strategy 之前，逐一檢查：
     a. 每個請求權基礎的構成要件條文是否都已查到全文？
     b. 損害賠償的計算依據條文是否齊全？（如身體傷害需要 §193 + §195；物之毀損需要 §196）
     c. 是否有遺漏的特別規定？（如車禍案應檢查動力車輛 §191-2、僱用人責任 §188）
     d. 過失相抵（§217）、損害賠償範圍（§216）等通用條文是否已備齊？
     e. 是否需要獨立段落處理防禦性議題（特別是準備書狀和答辯狀）：
        - 過失相抵（§217）：若對方可能主張原告與有過失，應安排獨立段落論證
        - 時效（§197）：若案件時效可能成為爭點，應安排獨立段落論證
        - 即使案件事實對我方有利，仍應主動論證以封堵對方攻擊空間
     f. **section_law_plan 是否涵蓋所有內容段落？** 每個損害賠償項目、侵權行為歸責段、防禦性段落都必須有對應的法條分配。不要只列爭點段落。
   - 如果發現缺漏，立即補搜後再呼叫 finalize_strategy`;

const COMMON_TOOLS_AND_RULES = `
### Structuring 階段：輸出策略（呼叫 finalize_strategy 後）

當你完成推理和完整性檢查，呼叫 finalize_strategy 工具：
- reasoning_summary：整體策略方向（200字以內）
- per_issue_analysis：每個爭點的推理結論，包含選定的請求權基礎、需要的法條 ID、構成要件涵攝、攻防預判
- section_law_plan：**每個計畫段落**的法條分配（包含非爭點段落！）。必須涵蓋所有你計畫撰寫的內容段落，例如：侵權行為歸責、每個損害賠償項目（醫療費用、交通費用、財物損害等）、過失相抵（如有）。每個項目指定 label（段落主題）、law_ids（法條 ID）、reason（簡述理由）。前言和結論不需要列入。
然後輸出完整的 JSON 結果。

═══ 工具 ═══

- search_law(query, purpose, limit): 搜尋法條資料庫，回傳條文全文。purpose 說明搜尋理由。
- finalize_strategy(reasoning_summary, per_issue_analysis, supplemented_law_ids): 完成推理後呼叫此工具。reasoning_summary 放整體策略方向；per_issue_analysis 放每個爭點的推理結論（請求權基礎、法條、涵攝、攻防）。`;

const COMMON_CONTEXT_RULES = `═══ 事實運用規則 ═══

- 「承認」的事實：直接援引，不需要花篇幅論證
- 「爭執」的事實：需要重點論證，提出證據佐證
- 「自認」的事實：明確援引對方書狀中的自認
- 「推定」的事實：援引法律推定，轉移舉證責任

═══ 時間軸運用 ═══

- 時間軸提供案件事件的時序脈絡，★ 標記為關鍵事件
- 在設計論證策略時，利用時間軸確認事實發生順序，建立因果關係
- 若案件涉及時效問題，時間軸是判斷時效起算的重要依據

═══ Information Gaps 處理 ═══

- 如果有 critical 級別的資訊缺口，避開沒有證據支撐的論點或使用保守措辭
- 如果有 nice_to_have 級別，正常設計但備註可強化
- 不要腦補不存在的事實或證據`;

const COMMON_HARD_RULES = `═══ 硬性規則 ═══

- 在呼叫 finalize_strategy 之前，禁止輸出任何 JSON code block。所有推理必須以自然語言文字進行。
- 只有在 finalize_strategy 的 tool result 回傳後，才可以輸出完整的 JSON 結果。
- 每個 our claim 必須有 assigned_section
- 每個 theirs claim 的 assigned_section 為 null
- rebuttal 必須有 responds_to
- supporting 必須有 responds_to
- primary 的 responds_to 為 null
- 對方每個主要主張都需要有 ours claim 來回應
- 不可捏造不存在的事實或證據
- legal_reasoning 中提到的法條必須是已查到全文的法條（不可只憑記憶引用）
- legal_reasoning 不超過 500 字
- 如果你發現某條法條被截斷（結尾有「...（截斷）」），且你需要完整內容來分析要件，請用 search_law 搜尋該條號的完整全文。`;

// ── briefMode-specific overlay 指引 ──

const SUPPLEMENT_OVERLAY = `

═══ 準備書狀特別指引 ═══

你正在撰寫準備書狀，核心目的是回應對造上一輪的攻防。

1. 優先從下方 [對造書狀] 區塊識別對方的每一項主張和論點
2. 對方的每個新主張、新證據、新法律論點都必須逐點回應
3. 除了回應對方，也可以補充我方新的攻擊或防禦方法
4. section 規劃應以「回應對方各點主張」為主軸，每個主要主張安排獨立段落
5. 若對方提出新證據，規劃對應的反駁策略（質疑證據力、提出反證、或區分其證明範圍）
6. 若 [對造書狀] 區塊不存在，根據爭點清單中的對方立場進行回應`;

const CHALLENGE_OVERLAY = `

═══ 上訴狀特別指引 ═══

你正在撰寫上訴狀，核心目的是指出原判決的認事用法錯誤。

1. 優先從下方 [原審判決] 區塊識別原判決的各項認定和理由
2. 對每項認定判斷錯誤類型：
   a. 事實認定錯誤：忽略關鍵證據、錯誤推論事實、違反經驗法則
   b. 法律適用錯誤：引用錯誤法條、錯誤解釋法律要件、漏未適用應適用之法律
   c. 判決理由矛盾：前後認定不一致、理由與主文矛盾
   d. 判決金額計算錯誤：計算基礎有誤、遺漏應計項目
3. section 規劃以「原判決第X項錯誤」為主軸
4. 每個上訴理由的結構：原判決認定 → 錯在哪裡 → 正確見解 → 法律依據
5. 搜尋最高法院相關判例來支持上訴主張
6. 若 [原審判決] 區塊不存在，根據爭點清單和案件摘要推斷應挑戰的爭點`;

/** Unified briefMode config: system prompt overlay + focus document section header */
const BRIEF_MODE_CONFIG: Partial<
  Record<BriefModeValue, { overlay: string; docTitle: string; docDesc: string }>
> = {
  supplement: {
    overlay: SUPPLEMENT_OVERLAY,
    docTitle: '對造書狀（你需要逐點回應）',
    docDesc: '以下是對方提出的書狀，你的準備書狀需要針對這些主張逐一回應：',
  },
  challenge: {
    overlay: CHALLENGE_OVERLAY,
    docTitle: '原審判決（你需要逐點指出錯誤）',
    docDesc: '以下是你要挑戰的判決，逐一找出認事用法錯誤：',
  },
};

// ── 組裝 System Prompt ──

export const buildReasoningSystemPrompt = (
  mode: PipelineMode,
  briefMode?: BriefModeValue | null,
): string => {
  const isDefense = mode === 'defense';
  const roleIntro = isDefense
    ? '你是一位資深台灣訴訟律師，正在為被告方制定答辯策略。你可以使用文字自由推理，也可以搜尋法條資料庫來補充推理所需的法律依據。'
    : '你是一位資深台灣訴訟律師，正在為案件制定論證策略。你可以使用文字自由推理，也可以搜尋法條資料庫來補充推理所需的法律依據。';
  const workflow = isDefense ? DEFENSE_REASONING_WORKFLOW : COMPLAINT_REASONING_WORKFLOW;
  const claimsRules = getClaimsRules(mode);
  const sectionRules = getSectionRules(mode);
  const jsonSchema = getJsonSchema(mode);

  const overlay = (briefMode && BRIEF_MODE_CONFIG[briefMode]?.overlay) || '';

  return `${roleIntro}

═══ 你的工作流程 ═══
${workflow}
${COMMON_SEARCH_INSTRUCTIONS}
${COMMON_TOOLS_AND_RULES}

${claimsRules}

${sectionRules}

${COMMON_CONTEXT_RULES}

${WRITING_CONVENTIONS}

${jsonSchema}

${COMMON_HARD_RULES}${overlay}`;
};

// ── 焦點文件專區 ──

const buildFocusDocSection = (
  briefMode: BriefModeValue | null | undefined,
  focusDocuments: ReasoningStrategyInput['focusDocuments'],
): string => {
  if (!focusDocuments || focusDocuments.length === 0) return '';
  const cfg = briefMode ? BRIEF_MODE_CONFIG[briefMode] : undefined;
  if (!cfg) return '';

  const docs = focusDocuments
    .map((d) => `【${d.filename}】(${d.fileId})\n${d.content}`)
    .join('\n\n---\n\n');
  return `\n\n═══ ${cfg.docTitle} ═══\n${cfg.docDesc}\n\n${docs}\n`;
};

// ── Build user message for reasoning strategy agent ──

export const buildReasoningStrategyInput = (
  input: ReasoningStrategyInput,
  hasTemplate = false,
): string => {
  const issueText = input.legalIssues
    .map((issue) => {
      let text = `- [${issue.id}] ${issue.title}\n  我方：${issue.our_position}\n  對方：${issue.their_position}`;
      if (issue.mentioned_laws.length > 0) {
        text += `\n  提及法條：${issue.mentioned_laws.join('、')}`;
      }
      return text;
    })
    .join('\n');

  const lawText =
    input.fetchedLaws.length > 0
      ? input.fetchedLaws
          .map((l) => `- [${l.id}] ${l.law_name} ${l.article_no}\n  ${l.content}`)
          .join('\n\n')
      : '（無預先查到的法條，請視需要使用 search_law 搜尋）';

  const fileText = input.fileSummaries
    .map((f) => `- [${f.id}] ${f.filename} (${f.category || '未分類'}): ${f.summary}`)
    .join('\n');

  const gapText =
    input.informationGaps.length > 0 ? input.informationGaps.map((g) => `- ${g}`).join('\n') : '無';

  const damageText =
    input.damages.length > 0
      ? input.damages
          .map((d) => `- ${getDamageLabel(d)}：NT$ ${d.amount.toLocaleString()}`)
          .join('\n')
      : '無';

  const totalDamage = input.damages.reduce((sum, d) => sum + d.amount, 0);

  const userLawText =
    input.userAddedLaws.length > 0
      ? input.userAddedLaws
          .map(
            (l) => `- [${l.id}] ${l.law_name} ${l.article_no}\n  ${truncateText(l.content, 200)}`,
          )
          .join('\n')
      : '無';

  const timelineText =
    input.timeline.length > 0
      ? input.timeline
          .map((t) => `- ${t.date} ${t.is_critical ? '★' : ' '} ${t.title}：${t.description}`)
          .join('\n')
      : '無';

  const meta = input.caseMetadata;
  const metaLines = buildCaseMetaLines(meta);
  const caseMetaBlock = metaLines.length > 0 ? `\n[案件基本資訊]\n${metaLines.join('\n')}\n` : '';
  const instructionsBlock = buildInstructionsBlock(meta?.caseInstructions);

  const structureGuidance = hasTemplate ? '' : `\n\n${FALLBACK_GUIDANCE}`;

  const caseTypeGuidance = getCaseTypeGuidance(input.caseSummary || '', meta?.clientRole);
  const caseTypeBlock = caseTypeGuidance ? `\n\n${caseTypeGuidance}` : '';

  const undisputedText =
    input.undisputedFacts.length > 0
      ? input.undisputedFacts.map((f) => `- ${f.description}`).join('\n')
      : '（無）';

  return `[案件全貌]
${input.caseSummary || '（尚未整合）'}
${caseMetaBlock}${instructionsBlock}
[書狀名稱] ${input.templateTitle}

[不爭執事項]
${undisputedText}

[爭點清單]
${issueText || '（尚未分析）'}

[已查到的法條全文]
${lawText}

[案件檔案摘要]
${fileText}
${buildFocusDocSection(input.briefMode, input.focusDocuments)}
[Information Gaps]
${gapText}

[使用者手動加入的法條]
${userLawText}

[損害賠償]
${damageText}${input.damages.length > 0 ? `\n合計：NT$ ${totalDamage.toLocaleString()}` : ''}

[時間軸]
${timelineText}
${caseTypeBlock}${structureGuidance}
請開始分析。先用文字推理（請求權基礎分析、構成要件檢視、攻防預判），如果需要額外法條就用 search_law 搜尋。推理完成後呼叫 finalize_strategy，然後輸出完整 JSON。`;
};
