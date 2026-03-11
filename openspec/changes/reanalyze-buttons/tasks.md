## 1. Backend Service Layer

- [x] 1.1 建立 `src/server/services/analysisService.ts`，從 `analysisFactory.ts` 抽出核心邏輯（loadReadyFiles → buildFileContext → callGeminiNative → parse → persist），回傳 `{ success, data, summary }` 或 `{ success: false, error }`
- [x] 1.2 重構三個 agent tool handler（`analyzeDisputes.ts`、`calculateDamages.ts`、`generateTimeline.ts`）為 thin wrapper，呼叫 service 後送 SSE event

## 2. API Route

- [x] 2.1 在 `src/server/schemas/` 新增 `analyze.ts` Zod schema（`{ type: z.enum(['disputes', 'damages', 'timeline']) }`）
- [x] 2.2 新增 `src/server/routes/analyze.ts` route：`POST /api/cases/:caseId/analyze`，用 `parseBody()` 驗證 body，呼叫 service，回傳 JSON
- [x] 2.3 在 `src/index.ts` 掛載 analyze route

## 3. Frontend Store

- [x] 3.1 在 `useAnalysisStore` 新增 `runAnalysis(caseId: string, type: 'disputes' | 'damages' | 'timeline')` 方法，POST API → 更新 store state → toast 通知

## 4. Frontend UI — 各 Tab 按鈕

- [x] 4.1 建立共用的 `ReanalyzeButton` 元件：RefreshCw icon + Tooltip + AlertDialog 確認邏輯（根據 hasData / processingCount 決定提示內容）
- [x] 4.2 修改 `DisputesTab.tsx`：加入右上角 ReanalyzeButton（有資料時）+ empty state 的「AI 自動分析」按鈕
- [x] 4.3 修改 `DamagesTab.tsx`：加入右上角 ReanalyzeButton（有資料時）+ empty state 按鈕改走新 API
- [x] 4.4 修改 `TimelineTab.tsx`：加入右上角 ReanalyzeButton（有資料時）+ empty state 按鈕改走新 API

## 5. 驗證

- [ ] 5.1 手動測試：empty state 按鈕觸發分析 → 資料正確顯示
- [ ] 5.2 手動測試：有資料時按 RefreshCw → 確認框 → 重新分析 → 資料更新
- [ ] 5.3 手動測試：有 processing 檔案時按分析 → 提示訊息正確
- [ ] 5.4 手動測試：聊天觸發分析仍正常運作（agent tool 路徑）
- [x] 5.5 `npx tsc --noEmit` 型別檢查通過
