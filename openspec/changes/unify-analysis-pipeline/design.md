## Context

目前有兩套爭點分析邏輯：

1. **手動分析**（`analysisService.ts`）：Gemini one-shot on file summaries → 只產出 disputes（title, positions, evidence, law_refs）
2. **Pipeline 分析**（`caseAnalysisStep.ts` → `orchestratorAgent.ts`）：Case Reader（tool-loop 讀全文）→ Issue Analyzer（深度分析）→ 產出 disputes + facts + parties

Pipeline 有 `hasUsableDisputes` 檢查：如果 disputes 已存在就跳過深度分析。這意味著手動分析的低品質結果會導致 pipeline 後續跳過深度分析。

## Goals / Non-Goals

**Goals:**
- 手動爭點分析呼叫與 pipeline 相同的 Case Reader + Issue Analyzer
- 統一 persist 邏輯（disputes、parties、facts）
- Pipeline 的 `caseAnalysisStep` 可以呼叫 service 層，減少重複程式碼

**Non-Goals:**
- 不改 damages/timeline 分析邏輯（這兩個手動和 pipeline 已經一致）
- 不改 claims 生成（claims 仍只在 Step 2 Reasoning Strategy 產生）
- 不改前端 API 介面或 UI 元件
- 不處理 SSE streaming progress（手動分析是同步 request/response）

## Decisions

### 1. 抽出 `runDeepDisputeAnalysis()` 到 service 層

**決定**：在 `analysisService.ts` 新增 `runDeepDisputeAnalysis()`，內部呼叫 `runCaseReader()` + `runIssueAnalyzer()`。

**替代方案**：直接在 API route 呼叫 orchestratorAgent → 但這會把 route 和 agent 耦合，且 orchestratorAgent 的 progress callback 是為 SSE 設計的。

**做法**：
- `runCaseReader()` 和 `runIssueAnalyzer()` 已經是獨立的 exported function，可以直接呼叫
- progress callback 傳 no-op（手動分析不需要 SSE progress）
- 組裝 `OrchestratorInput` 需要：readyFiles（帶 full_text）、existingParties、caseMetadata、templateTitle
- `caseMetadata` 和 `templateTitle` 在手動分析時可以從 DB 查詢或設為空值

### 2. 統一 persist 邏輯

**決定**：`persistDisputes()` 改為接收 `LegalIssue[]`（而非 `DisputeItem[]`），統一處理 facts、evidence、law_refs、parties。

**原因**：`LegalIssue` 是 `DisputeItem` 的超集（多了 facts、key_evidence、mentioned_laws 等欄位），用同一個 persist function 避免兩套寫入邏輯。

### 3. Pipeline `caseAnalysisStep` 改呼叫 service

**決定**：`caseAnalysisStep.ts` 的 disputes 分析路徑改為呼叫 `runDeepDisputeAnalysis()`，但保留 SSE progress 的 hook。

**做法**：service 層接受一個 optional `progress` callback，pipeline 傳實際的 SSE callback，手動分析不傳。

### 4. `runCaseReader` 需要 full_text，不只是 summary

**現狀**：手動分析的 `loadReadyFiles()` 載入 summary，Case Reader 需要透過 tool 讀取 full_text。

**決定**：`runCaseReader` 內部已經有 `read_file` tool 來讀全文，不需要改動它的輸入。只需要正確組裝 `OrchestratorInput`（readyFiles 帶 summary，Case Reader 自己決定要不要讀全文）。

### 5. Timeout 處理

**現狀**：API route 目前沒有 AbortSignal。Case Reader + Issue Analyzer 需要 signal。

**決定**：在 service 層用 `AbortController` + 合理 timeout（120s）。Workers 本身有 30s CPU time limit，但 AI call 是 I/O 等待不算 CPU time。

## Risks / Trade-offs

- **[慢]** 深度分析比 one-shot 慢很多（Case Reader 要讀多個檔案 + Issue Analyzer）→ 前端 loading 狀態已有（RefreshCw spin），但使用者需要等更久。可考慮未來加 streaming progress，但不在此 change 範圍。
- **[Workers timeout]** Cloudflare Workers 預設 30s request timeout → 但 D1 和 AI calls 是 I/O，不算 CPU time。如果檔案很多，Case Reader 可能跑超過 30s wall time → 需確認 Workers timeout 設定（`wrangler.jsonc` 的 `limits`）。
- **[Fallback]** 如果 Case Reader 或 Issue Analyzer 失敗 → service 層需要 fallback 邏輯（pipeline 中已有 `fallbackToAnalyzeDisputes`），可以複用。
