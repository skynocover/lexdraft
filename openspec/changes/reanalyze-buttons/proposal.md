## Why

律師上傳新檔案後，需要重新分析爭點/金額/時間軸。目前只能透過聊天訊息觸發（如「請幫我分析爭點」），這會污染聊天紀錄、走完整 agent loop 導致速度慢、且 UX 不直覺。需要在分析面板提供直接按鈕讓律師一鍵重新分析。

## What Changes

- 新增 `POST /api/cases/:caseId/analyze` API endpoint，支援 `{ type: 'disputes' | 'damages' | 'timeline' }` 直接觸發分析
- 從 `analysisFactory.ts` 抽出共用邏輯到 `analysisService.ts`，API route 和 agent tool 共用同一份邏輯
- 各分析 Tab（爭點/金額/時間軸）有資料時，右上角顯示 `RefreshCw` icon button（Tooltip 提示功能）
- 點擊按鈕時根據情況跳確認框：有 processing 檔案提示結果可能不完整、有舊資料提示會被覆蓋
- Empty state 的 CTA 按鈕改走新 API（不需確認框）
- Agent tool handler 改為呼叫 service 層的 thin wrapper，保持聊天觸發能力

## Capabilities

### New Capabilities
- `direct-analysis-api`: 獨立的分析 API endpoint，不經過 agent loop，直接 request/response 回傳分析結果
- `reanalyze-buttons`: 分析面板各 Tab 的重新分析按鈕 UI，含確認框邏輯與 loading 狀態

### Modified Capabilities

## Impact

- **Backend**：新增 `src/server/services/analysisService.ts`、新增 analyze route、修改 agent tool handlers 為 thin wrapper
- **Frontend**：修改 `DisputesTab.tsx`、`DamagesTab.tsx`、`TimelineTab.tsx` 加入按鈕；修改 `useAnalysisStore.ts` 加入 API 呼叫方法
- **API**：新增 `POST /api/cases/:caseId/analyze` endpoint
- **依賴**：無新增依賴，使用現有 shadcn AlertDialog + Tooltip
