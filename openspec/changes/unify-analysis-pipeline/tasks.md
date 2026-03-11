## 1. Service 層：新增深度爭點分析

- [x] 1.1 在 `analysisService.ts` 新增 `runDeepDisputeAnalysis(caseId, db, drizzle, aiEnv)` 函式，內部組裝 `OrchestratorInput`、呼叫 `runCaseReader()` + `runIssueAnalyzer()`，回傳 `AnalysisResult`
- [x] 1.2 組裝 `OrchestratorInput`：從 DB 查詢 readyFiles（帶 summary）、existingParties（從 cases 表）、caseMetadata、templateTitle；建立 no-op progress callback 和 AbortSignal（120s timeout）
- [x] 1.3 加入 fallback：Case Reader 或 Issue Analyzer 失敗時，fallback 到現有的 Gemini one-shot disputes 分析
- [x] 1.4 更新 `persistDisputes()`：接收 `LegalIssue[]`，儲存 facts（JSON stringify 存入 disputes 表或 cases 表），同步 parties 到 cases 表

## 2. 整合到 runAnalysis

- [x] 2.1 修改 `runAnalysis()` 的 disputes config：改為呼叫 `runDeepDisputeAnalysis()` 而非 `runAnalysisCore()`
- [x] 2.2 移除 `analysisService.ts` 中 disputes 專用的 prompt（`buildDisputesPrompt`）和 schema import（`DISPUTES_SCHEMA`），但保留作為 fallback 使用

## 3. Pipeline 共用 service 層

- [x] 3.1 在 `runDeepDisputeAnalysis()` 加入 optional `progress?: OrchestratorProgressCallback` 參數，讓 pipeline 傳入 SSE progress callback
- [x] 3.2 重構 `caseAnalysisStep.ts` 的 disputePromise：`hasUsableDisputes === false` 時呼叫 `runDeepDisputeAnalysis()`（帶 progress callback），取代直接呼叫 `runCaseReader` + `runIssueAnalyzer`
- [x] 3.3 確保 pipeline 的 SSE events（`set_disputes`、`set_parties`）仍正常發送

## 4. 驗證

- [x] 4.1 `npx tsc --noEmit` 型別檢查通過
- [ ] 4.2 手動測試：空白案件按分析 → 深度分析執行 → disputes 包含 facts、parties 更新
- [ ] 4.3 手動測試：有資料時按重新分析 → 確認框 → 深度分析 → 資料更新、舊 claims 被清除、damages 保留
- [ ] 4.4 手動測試：Pipeline 觸發分析仍正常（SSE progress 正常）
