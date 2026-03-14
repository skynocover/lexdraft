## 1. DB Schema Migration

- [x] 1.1 在 `src/server/db/schema.ts` 的 `cases` 表新增 `disputes_analyzed_at` 和 `timeline_analyzed_at` 欄位（`text`, nullable）
- [x] 1.2 執行 `npm run db:generate` 產生 migration
- [x] 1.3 執行 `npm run db:migrate:local` 套用 migration

## 2. Backend — 分析完成寫入 timestamp

- [x] 2.1 修改 `src/server/services/analysisService.ts`：`runDeepDisputeAnalysis` 成功持久化 disputes 後，`UPDATE cases SET disputes_analyzed_at = new Date().toISOString() WHERE id = caseId`
- [x] 2.2 修改 `analysisService.ts`：timeline 分析成功持久化後，同樣寫入 `timeline_analyzed_at`
- [x] 2.3 修改 `src/server/routes/analyze.ts`：response 加入 `analyzed_at` 欄位值

## 3. Frontend — Store 更新

- [x] 3.1 修改 `src/client/stores/useCaseStore.ts`：`CurrentCase` type 新增 `disputes_analyzed_at` 和 `timeline_analyzed_at`
- [x] 3.2 修改 `src/client/stores/useAnalysisStore.ts`：`runAnalysis` 成功後，呼叫 `useCaseStore` 更新 `currentCase` 的對應 timestamp
- [x] 3.3 新增 derived selector `useNewFileCount(type: 'disputes' | 'timeline')`：計算 `files.filter(ready && created_at > analyzed_at).length`，放在 `useCaseStore` 或獨立 hook

## 4. Frontend — Tab Badge UI

- [x] 4.1 修改 `src/client/components/layout/RightSidebar.tsx`：爭點和時間軸 tab 標籤旁顯示 badge 數字（count > 0 時）
- [x] 4.2 Badge 樣式：小圓形 accent 背景 + 白色數字，與 tab 標籤對齊

## 5. Frontend — Inline Banner

- [x] 5.1 建立 `src/client/components/analysis/StaleAnalysisBanner.tsx`：共用 banner 元件，接收 `count` 和 `onReanalyze`
- [x] 5.2 修改 `DisputesTab.tsx`：在爭點列表上方（header 下方）加入 banner
- [x] 5.3 修改 `TimelineTab.tsx`：同樣位置加入 banner

## 6. 驗證

- [x] 6.1 `npx tsc --noEmit` 型別檢查通過
- [ ] 6.2 手動測試：上傳新檔案 → ready 後 tab badge 出現正確數字
- [ ] 6.3 手動測試：重新分析後 badge 消失
- [ ] 6.4 手動測試：關閉瀏覽器重開 → badge 仍正確顯示
- [ ] 6.5 手動測試：從未分析過的案件不顯示 badge
- [x] 6.6 Prettier format：`npx prettier --write` 所有修改的檔案
