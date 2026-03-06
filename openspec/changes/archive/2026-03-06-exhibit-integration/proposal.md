## Why

證物管理目前獨立在右側 ExhibitsTab，與左側卷宗（FilesSection）高度重複 — 同一個檔案出現在兩個地方，律師不確定該在哪邊操作。此外，editor 中的 citation 以 superscript 小數字顯示，與最終 Word 匯出的括號格式不一致，不符合所見即所得原則。

整合證物管理進卷宗、讓 citation 顯示符合書狀實際格式，可以減少 UI 複雜度並提升律師信任感。

## What Changes

- **Citation 顯示改為 inline 括號**：從 superscript badge（如 `¹`）改為正文大小的括號文字（如 `（甲證1）`、`（民法第184條）`），所見即所得
- **卷宗整合證物管理**：將 ExhibitsTab 的功能（drag reorder、doc_type 編輯、新增/刪除 exhibit）合併進 FilesSection
- **卷宗排序改為 exhibit 優先**：甲方證物 → 乙方證物 → 未編號，取代現有的 category 排序
- **Category 連動 Prefix**：律師在卷宗改 file category 時，自動更新對應 exhibit 的 prefix（甲↔乙）並重新編號
- **Exhibit label 直接編輯**：點擊 exhibit label 可 popover 修改 prefix/number（escape hatch）
- **移除 ExhibitsTab**：右側 analysis panel 不再有獨立的 exhibits tab
- **不做**：匯出證物清單按鈕、description 編輯、跨 prefix 拖動

## Capabilities

### New Capabilities
- `citation-wysiwyg`: Citation 從 superscript badge 改為 inline 括號文字，與 Word 匯出格式一致
- `files-exhibit-integration`: 卷宗面板整合證物管理功能（排序、drag reorder、doc_type、exhibit label 編輯）
- `category-prefix-sync`: File category 變更時自動連動 exhibit prefix 更新與重新編號

### Modified Capabilities

## Impact

- **前端**：`CitationNodeView.tsx`、`globals.css`、`FilesSection.tsx`、`FileItem.tsx`、`RightSidebar.tsx`、`useUIStore.ts`
- **後端**：files route 或 exhibits route 需處理 category → prefix 連動
- **刪除**：`ExhibitsTab.tsx`
- **依賴**：需要 `@dnd-kit/core`、`@dnd-kit/sortable`（已安裝）
