## 1. API Endpoints

- [x] 1.1 新增 PATCH `/api/cases/:caseId/disputes/:id` — 更新 title，驗證非空
- [x] 1.2 新增 DELETE `/api/cases/:caseId/disputes/:id` — 先刪 claims（where dispute_id），再刪 dispute

## 2. Zustand Store

- [x] 2.1 `useAnalysisStore` 新增 `updateDispute(id, { title })` action — call PATCH API + 更新 local state
- [x] 2.2 `useAnalysisStore` 新增 `removeDispute(id)` action — call DELETE API + 從 disputes 和 claims 移除 local state

## 3. DisputeCard UI

- [x] 3.1 DisputeCard header 第一行加 hover 顯示 Pencil + Trash2 按鈕（參考 DamageCard pattern）
- [x] 3.2 Pencil 按鈕觸發 inline edit：標題 p 變成 input，Enter 儲存 / Escape 取消
- [x] 3.3 Trash2 按鈕觸發 ConfirmDialog，確認後呼叫 removeDispute
- [x] 3.4 DisputeCard 直接使用 store actions + useCaseStore（不需要從 DisputesTab 傳 callback）

## 4. 驗證

- [x] 4.1 npx tsc --noEmit 通過
- [x] 4.2 Prettier format
