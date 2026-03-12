## 1. 資料層

- [x] 1.1 前端 `Damage` interface（`useAnalysisStore.ts`）補上 `dispute_id: string | null`
- [x] 1.2 確認 damages API response 包含 `dispute_id`，若缺少則修正 route/query
- [x] 1.3 `DamageFormDialog` 支援接收 `disputeId` prop，新增/編輯時帶入 `dispute_id`

## 2. Sidebar Tab 結構

- [x] 2.1 `useUIStore` 修改 `SidebarTab` type：`'case-info' | 'case-materials' | 'analysis'` → `'case-info' | 'disputes' | 'case-materials'`
- [x] 2.2 `useUIStore` 移除 `analysisSubTab` 和 `setAnalysisSubTab`
- [x] 2.3 `RightSidebar.tsx` 更新頂層 tab 定義：[案件資訊] [爭點] [卷宗]
- [x] 2.4 `RightSidebar.tsx` 移除 `AnalysisSidebarContent` 組件（含 sub-tab pills）
- [x] 2.5 爭點 tab 內容直接渲染 `DisputesTab`

## 3. 爭點卡片嵌入金額

- [x] 3.1 `DisputesTab` 按 `dispute_id` 分組 damages，傳入每個 DisputeCard
- [x] 3.2 `DisputeCard` header 顯示金額小計（摺疊可見，無金額時不顯示）
- [x] 3.3 `DisputeCard` 展開區新增「請求金額」區塊：inline 金額列表 + [＋] 按鈕
- [x] 3.4 金額列表每項：描述 + 金額 + hover 編輯/刪除 icon + 點擊展開 basis
- [x] 3.5 金額 CRUD 整合：新增自動帶 `dispute_id`，編輯/刪除呼叫 `useAnalysisStore`

## 4. 未分類金額 + 時間軸 + 總額

- [x] 4.1 `DisputesTab` 底部新增「未分類金額」collapsible 區塊（`dispute_id = null` 的 damages）
- [x] 4.2 未分類金額區塊支援 CRUD（新增時 `dispute_id = null`）
- [x] 4.3 `DisputesTab` 底部新增「時間軸」collapsible 區塊，渲染 `TimelineTab`
- [x] 4.4 `DisputesTab` 底部 sticky bar 顯示請求總額

## 5. 清理

- [x] 5.1 移除獨立的 `DamagesTab` 匯入（若不再被任何地方引用）
- [x] 5.2 確認 `useChatStore` 等處對 `analysisSubTab` 的引用已清除
- [x] 5.3 TypeScript 型別檢查通過（`npx tsc --noEmit`）（pre-existing zod errors only）
- [x] 5.4 Prettier 格式化
