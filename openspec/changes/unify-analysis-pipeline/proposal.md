## Why

手動重新分析（ReanalyzeButton）使用的是輕量 Gemini one-shot（`analysisService.ts`），而 pipeline 使用的是深度分析（Case Reader + Issue Analyzer）。兩者產出品質不同：輕量版只產出 disputes，深度版還產出 facts、parties、完整的 our_position/their_position。更糟的是，pipeline 有 `hasUsableDisputes` 檢查——如果律師先按了手動分析產出低品質爭點，後續 pipeline 會直接沿用這些低品質結果，跳過深度分析。

統一為同一套分析邏輯，消除不一致性。

## What Changes

- 重構 `analysisService.ts` 的 disputes 分析：從 Gemini one-shot 改為呼叫 `runCaseReader()` + `runIssueAnalyzer()`（與 pipeline 相同）
- 保留 damages 和 timeline 的現有 Gemini one-shot 邏輯不變（這兩個在 pipeline 中也是用相同的 tool handler）
- 更新 persist 邏輯：同步 parties 到 cases 表、儲存 facts 到 disputes
- 移除 `analysisService.ts` 中 disputes 相關的 prompt/schema（不再需要）
- API route（`POST /api/cases/:caseId/analyze`）介面不變，前端不需改動

## Capabilities

### New Capabilities
- `deep-dispute-analysis`: 獨立的深度爭點分析服務，呼叫 Case Reader + Issue Analyzer，可被 API route 和 pipeline 共用

### Modified Capabilities
（無既有 spec 需修改）

## Impact

- **`src/server/services/analysisService.ts`**：disputes 分析邏輯大改，damages/timeline 不動
- **`src/server/agent/pipeline/caseAnalysisStep.ts`**：可簡化，disputes 分析改為呼叫 service 層
- **`src/server/agent/orchestratorAgent.ts`**：`runCaseReader`、`runIssueAnalyzer` 需要能被 service 層呼叫（可能需調整參數簽名，移除 SSE progress 依賴）
- **DB 影響**：disputes 表寫入邏輯統一，parties 同步邏輯統一
- **前端**：無變動（API 介面不變）
