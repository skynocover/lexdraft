## ADDED Requirements

### Requirement: Flash Lite 渲染 header、靜態段落、footer

Pipeline Step 3 SHALL 使用一次 Gemini Flash Lite call 將 template 的 header 區、靜態段落（如訴之聲明）、footer 區與案件資料合併，產出填好資料的 Paragraph。

Flash Lite 接收：
- template 的 header/靜態段落/footer 原文
- 案件資料：plaintiff、defendant、case_number、court、client_role、damages total

Flash Lite 產出：
- 填好資料的段落文字（名字、案號、法院名、金額）
- 系統不知道的欄位留【待填：描述】

#### Scenario: 起訴狀 header 填入案件資料
- **WHEN** template header 含「原告　○○○」且 cases.plaintiff = "林小明"
- **THEN** Flash Lite 輸出中原告欄位顯示「原告　林小明」

#### Scenario: 缺少案號時顯示待填
- **WHEN** cases.case_number 為 null 且 template header 含「案號：【待填：案號】」
- **THEN** Flash Lite 輸出保留「案號：【待填：案號】」或等效的待填提示

#### Scenario: 訴之聲明填入 damages 金額
- **WHEN** template 壹、訴之聲明含「被告應給付原告＿＿元」且 damages total = 583200
- **THEN** Flash Lite 輸出中金額顯示「新臺幣583,200元」

#### Scenario: footer 填入法院名稱
- **WHEN** template footer 含「○○地方法院　【待填：庭別】　公鑒」且 cases.court = "臺北"
- **THEN** Flash Lite 輸出中法院顯示「臺灣臺北地方法院」，庭別保留【待填：庭別】

### Requirement: Strategy agent 自行判斷靜態 vs AI 段落

Strategy agent SHALL 接收 template 全文，自行判斷每個 `##` 段落是靜態段落（已有完整法律文字）還是 AI 段落（含撰寫指引）。Agent 只為 AI 段落產出 sections 計畫。

#### Scenario: 訴之聲明不被 AI 規劃
- **WHEN** template 的「壹、訴之聲明」段落含完整的聲明一、二、三項
- **THEN** strategy agent 不為此段落產出 section 計畫

#### Scenario: 事實及理由被 AI 規劃
- **WHEN** template 的「參、事實及理由」段落含「依爭點逐一展開...」指引文字
- **THEN** strategy agent 為此段落產出一或多個 section 計畫

### Requirement: Pipeline Step 3 三軌生成

Pipeline Step 3 SHALL 按以下三軌生成書狀段落：

1. **Flash Lite 軌**：header + 靜態段落 + footer → 填入案件資料
2. **AI 寫作軌**：前言/結論用 Gemini Flash，事實及理由用 Claude Sonnet + Citations
3. **Code 軌**：證據方法從 exhibits 表格式化

最終按 template 段落順序組裝。

#### Scenario: 完整書狀包含所有段落
- **WHEN** pipeline 完成 Step 3
- **THEN** 輸出的 paragraphs 按順序包含：header、靜態段落、AI 段落、證據方法、footer

#### Scenario: Flash Lite 渲染可與 Strategy 並行
- **WHEN** Step 2 strategy 開始執行
- **THEN** Flash Lite 的 header/footer 渲染可同時開始（不依賴 strategy 結果）

### Requirement: 移除 briefType 全面引用

系統 SHALL 從以下位置移除所有 briefType / brief_type 引用：
- PipelineContext 型別
- ContextStore
- Agent tool 定義（create_brief、write_full_brief）
- Orchestrator prompt
- Strategy prompt 及 constants
- Writer prompt
- Quality reviewer prompt
- 前端 stores 及 components

改用 template_id 和 template title。

#### Scenario: create_brief tool 使用 template_id
- **WHEN** AI 呼叫 create_brief tool
- **THEN** 參數為 template_id（string）而非 brief_type（enum）

#### Scenario: 前端書狀列表顯示 title
- **WHEN** 使用者在 sidebar 看到書狀列表
- **THEN** 每個書狀顯示其 title，不顯示 briefType badge（起/答/準/上）
