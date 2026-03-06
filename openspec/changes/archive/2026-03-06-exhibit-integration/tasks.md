## 1. Citation WYSIWYG

- [x] 1.1 修改 `globals.css` citation-badge 樣式：`vertical-align: baseline`、移除固定 font-size（繼承正文）、調整 padding
- [x] 1.2 修改 `CitationNodeView.tsx` badge 文字：file citation 顯示 `（${exhibitLabel || label}）`、law citation 顯示 `（${label}）`
- [x] 1.3 驗證 hover popover 不受影響

## 2. 卷宗排序與分組

- [x] 2.1 `FilesSection.tsx` 從 `useBriefStore` 讀取 exhibits，建立 `fileId → Exhibit` map
- [x] 2.2 排序邏輯改為 exhibit 優先：甲證 group（按 number）→ 乙證 group（按 number）→ 未編號（按 category）
- [x] 2.3 渲染分組標題（甲方證物 / 乙方證物 / 未編號），無 exhibit 時不顯示標題

## 3. FileItem 擴充

- [x] 3.1 新增 `exhibit` prop（`Exhibit | undefined`），從 FilesSection 傳入
- [x] 3.2 有 exhibit 時渲染 drag handle（`GripVertical` icon + `useSortable` hook）
- [x] 3.3 有 exhibit 時右側顯示 exhibit label（如 `甲證1`）
- [x] 3.4 有 exhibit 時渲染 doc_type inline select（影本/正本/繕本），onChange 呼叫 `PATCH exhibits/:id`
- [x] 3.5 exhibit label 可點擊 → Popover 編輯 prefix（select 甲證/乙證）和 number（input），確認後呼叫 API

## 4. Drag Reorder

- [x] 4.1 `FilesSection.tsx` 加 DndContext + 每個 prefix group 各一個 SortableContext
- [x] 4.2 handleDragEnd 呼叫 `useBriefStore.reorderExhibits()` → `PATCH reorder` API
- [x] 4.3 未編號區域不參與 drag

## 5. Category 連動 Prefix

- [x] 5.1 後端 files route PATCH category：檢查 file 是否有 exhibit，有則更新 prefix + renumber
- [x] 5.2 後端：category 改成 court/other 時（getExhibitPrefix 回傳 null），刪除 exhibit + renumber
- [x] 5.3 前端 `FilesSection.tsx` handleCategoryChange：成功後 reload exhibits，toast 通知 prefix 變更

## 6. 清理

- [x] 6.1 `RightSidebar.tsx` 移除 exhibits sub-tab 與 ExhibitsTab import
- [x] 6.2 `useUIStore.ts` 移除 `'exhibits'` from AnalysisSubTab type
- [x] 6.3 刪除 `src/client/components/analysis/ExhibitsTab.tsx`
- [x] 6.4 prettier format + tsc --noEmit 確認無錯誤
