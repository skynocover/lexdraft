## Split View Support

### Requirements

1. `A4PageEditor` 改為接收 `briefId: string` prop，從 `briefCache[briefId]` 讀取 brief 資料、dirty、saving 狀態
2. `EditorPanel` 渲染 brief tab 時，將 `tabData.briefId` 傳給 `A4PageEditor`
3. `EditorToolbar` 的 dirty/saving 狀態改從 `briefCache[briefId]` 讀取，`saveBrief` 改為 `saveBrief(briefId)`
4. `useAutoSave` hook 接收 `briefId` 參數，監聽對應 brief 的 dirty 狀態
5. `syncActiveTabStore` 在 brief tab 聚焦時設 `activeBriefId`（供 chat context 使用）
6. `focusPanel` 時，如果新 focused panel 的 active tab 是 brief，更新 `activeBriefId`

### Constraints

- `activeBriefId` 是全局唯一（不是 per-panel），代表 focused panel 的 brief
- 非 focused panel 的 brief 編輯不影響 `activeBriefId`
- Split view 使用現有 `useTabStore` 的 `splitPanel` 機制，不需新增 UI

### Acceptance Criteria

- Brief A 在 panel 1，Brief B 在 panel 2 → 各自顯示正確內容
- 編輯 panel 2 的 Brief B → B 的 dirty=true，A 不受影響
- 點擊 panel 1 → `activeBriefId` 變回 A → chat context 送 A
- 切走時自動存 dirty brief
