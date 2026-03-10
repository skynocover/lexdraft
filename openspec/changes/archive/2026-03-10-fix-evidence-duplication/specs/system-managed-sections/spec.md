## ADDED Requirements

### Requirement: Writer loop SHALL filter system-managed sections
Pipeline 的 writer loop 在遍歷 `store.sections` 之前，MUST 過濾掉 section 名稱包含 `AUTO_HEADINGS`（證據方法、證據）的項目，使其不進入 AI writer 呼叫。

#### Scenario: AI 規劃了證據方法 section
- **WHEN** Step 2 AI 輸出的 `sections[]` 中有 `section` 包含「證據方法」的項目
- **THEN** 該項目在 writer loop 之前被移除，不呼叫 AI writer API

#### Scenario: AI 規劃了僅含「證據」的 section
- **WHEN** Step 2 AI 輸出的 `sections[]` 中有 `section` 包含「證據」的項目
- **THEN** 該項目同樣被過濾，不進入 writer loop

#### Scenario: 正常 section 不受影響
- **WHEN** Step 2 AI 輸出的 `sections[]` 中有 `section` 為「參、事實及理由」
- **THEN** 該項目正常保留，進入 writer loop

### Requirement: AUTO_HEADINGS SHALL be a shared constant
`AUTO_HEADINGS` 陣列 MUST 定義在 `strategyConstants.ts`，由 `templateRenderer.ts` 和 `briefPipeline.ts` 共同 import，不得重複定義。

#### Scenario: templateRenderer 使用共用常數
- **WHEN** `templateRenderer.ts` 判斷是否跳過 auto-generated section
- **THEN** 使用從 `strategyConstants.ts` import 的 `AUTO_HEADINGS`

#### Scenario: briefPipeline 使用共用常數
- **WHEN** `briefPipeline.ts` 在 writer loop 前過濾 sections
- **THEN** 使用從 `strategyConstants.ts` import 的 `AUTO_HEADINGS`

### Requirement: Prompt SHALL instruct AI not to plan evidence sections
`SECTION_RULES` 常數 MUST 包含指令禁止 AI 規劃證據方法段落，明確說明證據方法由系統自動產生。

#### Scenario: Step 2 prompt 包含禁止規劃指令
- **WHEN** Step 2 AI 收到 `SECTION_RULES` prompt
- **THEN** 其中包含「不要規劃『證據方法』段落，證據方法由系統自動從證據清單產生」的指令
