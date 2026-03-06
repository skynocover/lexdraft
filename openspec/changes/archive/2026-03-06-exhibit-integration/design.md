## Context

exhibit-numbering change 已完成，系統有完整的 exhibits 資料層（DB table、auto-assign、CRUD API、SSE）。前端目前有兩個地方顯示檔案資訊：左側 FilesSection（卷宗）和右側 ExhibitsTab（證物管理），功能高度重複。Citation 在 editor 中以 superscript 小數字 badge 顯示，與 Word 匯出的括號格式不一致。

相關現有檔案：
- `src/client/components/layout/sidebar/FilesSection.tsx` — 卷宗列表，按 category 排序
- `src/client/components/layout/sidebar/FileItem.tsx` — 單一檔案行，有 category badge、summary 展開、刪除
- `src/client/components/analysis/ExhibitsTab.tsx` — 證物管理，有 drag reorder、doc_type、新增/刪除
- `src/client/components/editor/tiptap/extensions/CitationNodeView.tsx` — citation badge 渲染
- `src/client/styles/globals.css` — citation-badge CSS

## Goals / Non-Goals

**Goals:**
- Citation 所見即所得：editor 中顯示 `（甲證1）` `（民法第184條）`，與 Word 匯出一致
- 單一管理點：卷宗面板同時管理檔案與證物，不需要切換 tab
- Category 改變自動連動 exhibit prefix

**Non-Goals:**
- 匯出證物清單按鈕（後續加回）
- description 欄位編輯
- 跨 prefix（甲↔乙）拖動
- 改變 exhibit 資料層或 API（沿用 exhibit-numbering 的成果）

## Decisions

### D1: Citation 樣式 — inline 括號取代 superscript badge

**選擇**：改為 `vertical-align: baseline`，字體大小繼承正文，badge 文字加全形括號 `（）`

**替代方案**：保持 superscript 但改文字 → 不夠 WYSIWYG，superscript 在 Word 中不存在

**改動點**：
- `globals.css`: `.citation-badge` 的 `vertical-align`、`font-size`、`padding` 調整
- `CitationNodeView.tsx` line 157: badge 文字從 `index+1` 改為 `（${displayLabel}）`
- `displayLabel` 已有 exhibit label fallback 邏輯（line 102-103），不需改

### D2: FilesSection 排序 — exhibit 優先，未編號最後

**選擇**：排序邏輯改為 `(hasExhibit DESC, prefix ASC, number ASC, category)`

```
甲方證物（section header）
  甲證1 (甲) 交通事故分析表.pdf    影本▾
  甲證2 (證) 薪資證明.pdf          影本▾
乙方證物（section header）
  乙證1 (乙) 和解書.pdf            影本▾
未編號（section header）
  (法) 判決書.pdf
```

**實作**：FilesSection 從 useBriefStore 讀 exhibits，建立 `fileId → Exhibit` map，排序時優先按 exhibit。分組標題用簡單的 `<p>` 分隔線。

### D3: FileItem 擴充 — drag handle + exhibit label + doc_type

**選擇**：在現有 FileItem 上條件式加入新元素

```
有 exhibit：
┌──────────────────────────────────────────────┐
│ ⠿  (甲)  交通事故分析表.pdf    甲證1  影本▾ │
│           2025-01-15                     🗑  │
└──────────────────────────────────────────────┘

無 exhibit：
┌──────────────────────────────────────────────┐
│     (法)  判決書.pdf                     🗑  │
│           2025-03-01                         │
└──────────────────────────────────────────────┘
```

- **Drag handle**：用 `useSortable` hook，只在有 exhibit 時渲染 `<GripVertical>`
- **Exhibit label**：右側顯示 `甲證1`，可點擊彈出 Popover 修改 prefix/number
- **doc_type select**：inline `<select>`，只在有 exhibit 時顯示

### D4: Drag reorder — 同 prefix 內，用現有 reorder API

**選擇**：DndContext 包在 FilesSection 層級，每個 prefix group 用獨立的 SortableContext。拖放只在同 prefix 內生效，呼叫 `PATCH /api/cases/:caseId/exhibits/reorder`。

### D5: Category 連動 Prefix — 後端自動處理

**選擇**：在 files route 的 PATCH category 端點，檢查該 file 是否有 exhibit，有的話根據新 category + clientRole 計算新 prefix，更新 exhibit 並重新編號。

**流程**：
1. 律師點 category badge 改 category
2. `PUT /api/files/:id { category }` → 更新 file category
3. 後端同時查 exhibits 表，如有對應 exhibit → 用 `getExhibitPrefix(clientRole, newCategory)` 計算新 prefix
4. 更新 exhibit prefix + 重新編號（舊 prefix 和新 prefix 都要 renumber）
5. 回傳更新後的 file + exhibit 資訊
6. 前端 refreshExhibits

### D6: Exhibit label 直接編輯 — Popover escape hatch

**選擇**：點擊 exhibit label 彈出 Popover，可改 prefix（甲證/乙證 select）和 number（數字 input），呼叫 `PATCH /api/cases/:caseId/exhibits/:id`。不影響 file category。

## Risks / Trade-offs

- **[FileItem 複雜度增加]** → FileItem 從 145 行可能增加到 ~200 行，但仍在 300 行限制內。Exhibit 相關邏輯用 props 條件渲染，不需要的場景完全不渲染。
- **[Category 連動可能意外改 prefix]** → 律師改 category 時 toast 提示「證物編號已更新」，讓改動可見。直接編輯 prefix 的 escape hatch 可覆蓋。
- **[DndContext 與現有 FilesSection 排序衝突]** → 現有排序純前端計算，drag reorder 呼叫 API 後重新 fetch exhibits，排序自然更新。
