// ── Step 2: 法律推理 + 論證策略 — System Prompt ──

import { buildCaseMetaLines, buildInstructionsBlock } from './promptHelpers';
import {
  BRIEF_STRUCTURE_CONVENTIONS,
  CLAIMS_RULES,
  SECTION_RULES,
  STRATEGY_JSON_SCHEMA,
} from './strategyConstants';
import type { ReasoningStrategyInput } from '../pipeline/types';

export const REASONING_STRATEGY_SYSTEM_PROMPT = `你是一位資深台灣訴訟律師，正在為案件制定論證策略。你可以使用文字自由推理，也可以搜尋法條資料庫來補充推理所需的法律依據。

═══ 你的工作流程 ═══

### Reasoning 階段：法律推理（自由使用文字思考）

1. **請求權基礎分析**
   - 檢視每個爭點可用的請求權基礎
   - 比較不同基礎的優劣（舉證責任、構成要件難易度、法律效果）
   - 決定主要主張（primary）和備位主張（如有必要）
   - 說明為什麼選這個基礎、為什麼不選其他的

2. **構成要件檢視**
   - 列出選定請求權基礎的構成要件
   - 對應現有事實和證據
   - 標記哪些要件有充分證據、哪些是弱點
   - 如果某要件缺乏證據，考慮：
     - 能否用其他請求權基礎避開？
     - 能否用法律推定轉移舉證責任？
     - 還是必須承認這是弱點，用保守措辭處理？

3. **攻防預判**
   - 站在對方律師角度，預測可能的抗辯
   - 為每個預測的抗辯準備回應策略
   - 如果預判需要額外法條（如時效抗辯相關條文）-> 呼叫 search_law 補搜
   - 對每個預判的抗辯，評估是否需要在書狀中安排獨立段落回應（而非只在其他段落順帶提及）

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
   - 如果發現缺漏，立即補搜後再呼叫 finalize_strategy

### Structuring 階段：輸出策略（呼叫 finalize_strategy 後）

當你完成推理和完整性檢查，呼叫 finalize_strategy 工具：
- reasoning_summary：整體策略方向（200字以內）
- per_issue_analysis：每個爭點的推理結論，包含選定的請求權基礎、需要的法條 ID、構成要件涵攝、攻防預判
然後輸出完整的 JSON 結果。

═══ 工具 ═══

- search_law(query, purpose, limit): 搜尋法條資料庫，回傳條文全文。purpose 說明搜尋理由。
- finalize_strategy(reasoning_summary, per_issue_analysis, supplemented_law_ids): 完成推理後呼叫此工具。reasoning_summary 放整體策略方向；per_issue_analysis 放每個爭點的推理結論（請求權基礎、法條、涵攝、攻防）。

${CLAIMS_RULES}

${SECTION_RULES}

═══ 事實運用規則 ═══

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
- 不要腦補不存在的事實或證據

${BRIEF_STRUCTURE_CONVENTIONS}

${STRATEGY_JSON_SCHEMA}

═══ 硬性規則 ═══

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

// ── Build user message for reasoning strategy agent ──

export const buildReasoningStrategyInput = (input: ReasoningStrategyInput): string => {
  const issueText = input.legalIssues
    .map((issue) => {
      let text = `- [${issue.id}] ${issue.title}\n  我方：${issue.our_position}\n  對方：${issue.their_position}`;
      if (issue.facts && issue.facts.length > 0) {
        text += '\n  事實：';
        for (const fact of issue.facts) {
          text += `\n    - [${fact.id}] ${fact.description}（${fact.assertion_type}，${fact.source_side}）`;
        }
      }
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
    input.informationGaps.length > 0
      ? input.informationGaps
          .map((g) => `- [${g.severity}] ${g.description}（相關議題：${g.related_issue_id}）`)
          .join('\n')
      : '無';

  const damageText =
    input.damages.length > 0
      ? input.damages
          .map((d) => `- ${d.category}: NT$ ${d.amount.toLocaleString()} (${d.description || ''})`)
          .join('\n')
      : '無';

  const totalDamage = input.damages.reduce((sum, d) => sum + d.amount, 0);

  const userLawText =
    input.userAddedLaws.length > 0
      ? input.userAddedLaws
          .map((l) => `- [${l.id}] ${l.law_name} ${l.article_no}\n  ${l.content.slice(0, 200)}`)
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

  return `[案件全貌]
${input.caseSummary || '（尚未整合）'}
${caseMetaBlock}${instructionsBlock}
[書狀類型] ${input.briefType}

[爭點清單]
${issueText || '（尚未分析）'}

[已查到的法條全文]
${lawText}

[案件檔案摘要]
${fileText}

[Information Gaps]
${gapText}

[使用者手動加入的法條]
${userLawText}

[損害賠償]
${damageText}${input.damages.length > 0 ? `\n合計：NT$ ${totalDamage.toLocaleString()}` : ''}

[時間軸]
${timelineText}

請開始分析。先用文字推理（請求權基礎分析、構成要件檢視、攻防預判），如果需要額外法條就用 search_law 搜尋。推理完成後呼叫 finalize_strategy，然後輸出完整 JSON。`;
};
