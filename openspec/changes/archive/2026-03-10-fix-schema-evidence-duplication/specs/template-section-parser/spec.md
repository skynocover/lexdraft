## ADDED Requirements

### Requirement: extractSections 從 template markdown 解析段落清單
`extractSections()` 純函式 SHALL 接收 template markdown 字串，回傳段落清單陣列，每個段落包含 `name`（段落名稱，如「壹、訴之聲明」）和 `type`（`fixed` | `ai_planned` | `system_generated`）。

#### Scenario: 一般起訴狀 template
- **WHEN** 輸入一般起訴狀 template（含壹、訴之聲明 / 貳、事實及理由 / 參、證據方法）
- **THEN** 回傳 3 個段落：壹、訴之聲明 (fixed)、貳、事實及理由 (ai_planned)、參、證據方法 (system_generated)

#### Scenario: 損害賠償起訴狀 template
- **WHEN** 輸入損害賠償起訴狀 template（含壹、訴之聲明 / 貳、前言 / 參、事實及理由 / 肆、結論 / 伍、證據方法）
- **THEN** 回傳 5 個段落：壹、訴之聲明 (fixed)、貳、前言 (ai_planned)、參、事實及理由 (ai_planned)、肆、結論 (ai_planned)、伍、證據方法 (system_generated)

#### Scenario: 民事答辯狀 template
- **WHEN** 輸入答辯狀 template（含壹、答辯聲明 / 貳、前言 / 參、事實及理由 / 肆、結論 / 伍、證據方法）
- **THEN** 回傳 5 個段落：壹、答辯聲明 (fixed)、貳、前言 (ai_planned)、參、事實及理由 (ai_planned)、肆、結論 (ai_planned)、伍、證據方法 (system_generated)

#### Scenario: 民事準備書狀 template
- **WHEN** 輸入準備書狀 template（含壹、前言 / 貳、事實及理由 / 參、結論 / 肆、證據方法）
- **THEN** 回傳 4 個段落：壹、前言 (ai_planned)、貳、事實及理由 (ai_planned)、參、結論 (ai_planned)、肆、證據方法 (system_generated)

#### Scenario: 民事上訴狀 template
- **WHEN** 輸入上訴狀 template（含壹、上訴聲明 / 貳、前言 / 參、事實及理由 / 肆、結論 / 伍、證據方法）
- **THEN** 回傳 5 個段落：壹、上訴聲明 (fixed)、貳、前言 (ai_planned)、參、事實及理由 (ai_planned)、肆、結論 (ai_planned)、伍、證據方法 (system_generated)

#### Scenario: 民事聲請強制執行狀 template
- **WHEN** 輸入強制執行狀 template（含壹、執行名義 / 貳、請求金額 / 參、聲請執行標的 / 肆、事實及理由 / 伍、證據方法）
- **THEN** 回傳 5 個段落：壹、執行名義 (fixed)、貳、請求金額 (fixed)、參、聲請執行標的 (fixed)、肆、事實及理由 (ai_planned)、伍、證據方法 (system_generated)

#### Scenario: 未匹配的段落預設為 ai_planned
- **WHEN** template 包含不在已知清單中的段落名稱
- **THEN** 該段落 type 預設為 `ai_planned`

### Requirement: sectionsToPrompt 將段落清單轉為 prompt 注入文字
`sectionsToPrompt()` 純函式 SHALL 接收 `extractSections()` 的回傳值，產出格式化的文字區塊，明確標記每個段落的名稱和分工。

#### Scenario: 產出格式化段落清單
- **WHEN** 輸入一般起訴狀的段落清單
- **THEN** 產出包含段落名稱和分工標記的文字，fixed 段落標記為「固定內容，不需 AI 規劃」，ai_planned 標記為「需要 AI 規劃」，system_generated 標記為「系統自動產生，不需 AI 規劃」

### Requirement: STRATEGY_JSON_SCHEMA 不含 template-specific section 命名
`STRATEGY_JSON_SCHEMA` 的 JSON 範例 SHALL 使用通用佔位符作為 section 值，不得寫死任何特定 template 的段落名稱。

#### Scenario: 範例中的 section 值為佔位符
- **WHEN** 檢查 `STRATEGY_JSON_SCHEMA` 的 JSON 範例
- **THEN** 所有 section 值為佔位符描述（如「（依範本段落名稱）」），不含「貳、前言」「參、事實及理由」「伍、結論」等具體值

### Requirement: briefPipeline 防禦過濾 AI 產出的證據方法段落
`briefPipeline.ts` 在組裝 `allParagraphs` 時 SHALL 過濾掉 AI writer 產出的段落中 section 包含「證據」的段落。

#### Scenario: AI 誤產證據方法段落被過濾
- **WHEN** AI writer 產出的 paragraphs 中包含 section 為「參、證據方法」的段落
- **THEN** 該段落被從 allParagraphs 中移除，只保留程式產的證據段落
