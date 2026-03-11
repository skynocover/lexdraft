## ADDED Requirements

### Requirement: 手動爭點分析使用深度分析

手動觸發的爭點分析（透過 `POST /api/cases/:caseId/analyze { type: 'disputes' }`）SHALL 使用與 pipeline 相同的 Case Reader + Issue Analyzer 流程，而非 Gemini one-shot。

#### Scenario: 手動分析產出與 pipeline 一致
- **WHEN** 使用者透過 API 觸發 disputes 分析
- **THEN** 系統呼叫 Case Reader 讀取檔案全文，再呼叫 Issue Analyzer 深度分析
- **THEN** 產出的 disputes 包含 title、our_position、their_position、evidence、law_refs、facts

#### Scenario: 手動分析同步更新 parties
- **WHEN** Case Reader 識別出原告/被告
- **THEN** 系統同步更新 cases 表的 plaintiff/defendant 欄位

### Requirement: 分析失敗有 fallback

深度分析失敗時 SHALL fallback 到輕量 Gemini one-shot 分析，確保使用者不會得到空結果。

#### Scenario: Case Reader 失敗
- **WHEN** Case Reader 執行失敗（timeout、AI error 等）
- **THEN** 系統 fallback 到 Gemini one-shot 產出基本 disputes
- **THEN** API 回傳成功結果（使用者不需知道 fallback 發生）

#### Scenario: Issue Analyzer 失敗
- **WHEN** Case Reader 成功但 Issue Analyzer 失敗
- **THEN** 系統 fallback 到 Gemini one-shot 產出基本 disputes

### Requirement: Pipeline 共用 service 層

Pipeline 的 `caseAnalysisStep` SHALL 呼叫同一個 service 函式進行爭點分析，避免重複程式碼。

#### Scenario: Pipeline 呼叫 service 層
- **WHEN** Pipeline 需要進行深度爭點分析（`hasUsableDisputes === false`）
- **THEN** 呼叫 service 層的 `runDeepDisputeAnalysis()`
- **THEN** 產出結果與直接呼叫 orchestratorAgent 相同

#### Scenario: Pipeline 保留 SSE progress
- **WHEN** Pipeline 透過 service 層進行分析
- **THEN** SSE progress events（閱讀檔案、案件摘要、爭點分析）仍正常發送

### Requirement: FK 安全的 persist 邏輯

更新 disputes 時 SHALL 先處理 FK 依賴（claims、damages.dispute_id），再刪除舊 disputes。

#### Scenario: 重新分析不破壞 damages
- **WHEN** 已有手動建立的 damages 且重新分析 disputes
- **THEN** damages 記錄保留，只有 `dispute_id` 被設為 null
- **THEN** claims 被完全刪除（AI 生成，綁定 disputes）
