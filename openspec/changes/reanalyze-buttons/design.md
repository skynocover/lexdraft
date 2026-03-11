## Context

分析功能（爭點/金額/時間軸）目前只能透過聊天觸發，走 AgentDO tool-loop。三個分析工具共用 `analysisFactory.ts` 工廠模式：載入檔案 → 呼叫 Gemini Native（constrained decoding）→ 持久化 → 送 SSE。

現有入口：
- `DamagesTab` / `TimelineTab` 的 empty state 有「AI 自動計算/整理」按鈕，但實作是 `sendMessage()` 送聊天訊息
- `DisputesTab` 完全沒有觸發按鈕
- 三個工具之間無相依性，都只讀取案件檔案

## Goals / Non-Goals

**Goals:**
- 讓律師可以在分析面板直接觸發重新分析，不經過聊天
- 抽出 service 層讓 API route 和 agent tool 共用邏輯
- 提供適當的確認提示（覆蓋舊資料、檔案處理中）

**Non-Goals:**
- 不改變分析的 AI 邏輯（prompt、schema、model 選擇）
- 不新增批次「全部重新分析」按鈕
- 不處理 DELETE+INSERT 的 transaction 問題（現有架構已足夠安全）
- 不改變 agent tool 在聊天中的觸發能力

## Decisions

### D1: 抽 service 層而非直接在 route 中呼叫 factory

**選擇**：新增 `src/server/services/analysisService.ts`，封裝三個分析函式

**理由**：`analysisFactory` 的 `createAnalysisTool` 回傳的是 `ToolHandler`（需要 `ToolContext` 含 `sendSSE`），API route 不走 SSE。抽 service 層可以把「AI 呼叫 + 持久化」與「SSE 通知」解耦。

**替代方案**：直接在 route 中 import tool handler 並傳 mock SSE → 語意不清、容易混淆

**結構**：
```
analysisService.ts
  ├── runAnalysis(type, caseId, db, drizzle, aiEnv)
  │     → 回傳 { success, data, summary }
  │
  ├── 內部呼叫 loadReadyFiles + buildFileContext
  │   + callGeminiNative + persistAndNotify
  │
  └── persistAndNotify 不再負責 SSE（由呼叫端決定）

API route  → 呼叫 service → 回傳 JSON response
Agent tool → 呼叫 service → 送 SSE event
```

### D2: 單一 endpoint 用 type 參數區分

**選擇**：`POST /api/cases/:caseId/analyze`，body `{ type: 'disputes' | 'damages' | 'timeline' }`

**理由**：三個分析的流程完全一致（差異只在 prompt 和 schema），共用一個 endpoint 配 Zod validation 即可

**替代方案**：三個獨立 endpoint `/analyze-disputes`、`/analyze-damages`、`/analyze-timeline` → 重複的 route 設定，沒有實質好處

### D3: 同步 request/response 而非 SSE

**選擇**：API 直接回傳分析結果 JSON

**理由**：分析通常 3-5 秒完成（單次 Gemini 呼叫），不需要串流。前端用 loading spinner 即可。比 SSE 簡單很多。

### D4: 確認框條件合併

**選擇**：processing 檔案提示和覆蓋提示合併為一次 AlertDialog

**邏輯**：
| processing 檔案 | 有舊資料 | 行為 |
|:---:|:---:|---|
| 無 | 無 | 直接執行（empty state） |
| 有 | 無 | 確認框：檔案處理中提示 |
| 無 | 有 | 確認框：覆蓋提示 |
| 有 | 有 | 確認框：合併提示 |

### D5: processing 檔案數量從 useCaseStore 取得

**選擇**：前端從 `useCaseStore` 的 files 中計算 `status === 'processing'` 的數量，不需要額外 API 呼叫

## Risks / Trade-offs

- **[API timeout]** → Gemini 呼叫偶爾超過 30 秒 → Cloudflare Workers 預設 30s timeout 應足夠，且 `analysisFactory` 已設 `maxTokens: 8192` + `thinkingBudget: 0` 加速回應。若超時前端會收到 network error，toast 提示即可。
- **[重複觸發]** → 律師連點按鈕 → Loading 狀態下 disable 按鈕防止重複呼叫
- **[Agent tool 與 service 不同步]** → 改 service 邏輯但忘記測試 agent 路徑 → 風險低，因為 agent tool 變成 thin wrapper 直接呼叫 service
