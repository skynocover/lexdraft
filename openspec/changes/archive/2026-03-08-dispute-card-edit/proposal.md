## Why

爭點目前只能透過 `analyze_disputes` tool 全量重跑，無法個別修改。律師看到 AI 分析結果後，常見的需求是改掉不精準的標題或刪除不相關的爭點，但現在只能重新分析（會洗掉全部結果）。先支援最簡單的兩個操作：改標題 + 刪除。

## What Changes

- **新增 API**：`PATCH /api/cases/:caseId/disputes/:id`（更新標題）和 `DELETE /api/cases/:caseId/disputes/:id`（刪除爭點，cascade delete 關聯 claims）
- **新增 Zustand actions**：`useAnalysisStore` 新增 `updateDispute` 和 `removeDispute`
- **DisputeCard UI**：收合狀態 hover 顯示編輯/刪除按鈕；標題支援 inline edit（點擊編輯按鈕進入編輯模式）
- **刪除行為**：刪除爭點時一併刪除關聯 claims（`dispute_id` 匹配的 claims），書狀段落不受影響、不提示

## Capabilities

### New Capabilities

- `dispute-edit`: 爭點卡片的 inline 標題編輯和刪除功能，包含 API、store、UI

### Modified Capabilities

## Impact

- `src/server/routes/cases.ts` — 新增 PATCH/DELETE dispute endpoints
- `src/client/stores/useAnalysisStore.ts` — 新增 updateDispute、removeDispute actions
- `src/client/components/analysis/DisputesTab.tsx` — DisputeCard 新增 hover 按鈕、inline edit 模式
