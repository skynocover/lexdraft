## Why

卷宗檔案側邊欄有多項 UI/UX 細節影響法律工作者的使用體驗：日期顯示不符法律文件慣例（應使用民國年）、未編號檔案的分群語意不清、分類切換缺乏可發現性、原生 select 在 dark theme 下違和、空狀態缺乏引導。這些都是低成本但能顯著提升觀感與易用性的改善。

## What Changes

- **日期格式改民國年**：所有 file item 的 `doc_date` 從西元 (2024-10-12) 改為民國年顯示 (113-10-12)
- **未編號 item 移除 drag handle spacer**：沒有 exhibit 的 file item 不再顯示左側空白佔位
- **未編號 → 「其他文件」label**：將「未編號」群組標題改為更清楚的語意
- **影本 select 改 Shadcn**：原生 `<select>` 改用 Shadcn Popover/Select，統一 dark theme 風格
- **Category badge hover indicator**：hover 時視覺暗示 badge 可點擊切換分類
- **Empty state 加 upload CTA**：「尚無檔案」改為帶上傳按鈕的引導畫面
- **檔名加 tooltip**：truncate 的檔名 hover 時顯示完整名稱

## Capabilities

### New Capabilities
- `sidebar-files-polish`: 卷宗檔案側邊欄的 UI/UX 細節打磨，涵蓋日期格式、drag handle、label 語意、select 元件、badge 互動提示、empty state、tooltip

### Modified Capabilities

（無既有 spec 需修改）

## Impact

- **受影響檔案**：
  - `src/client/components/layout/sidebar/FileItem.tsx` — 日期格式、drag handle、影本 select、badge hover、tooltip
  - `src/client/components/layout/sidebar/FilesSection.tsx` — 群組 label、empty state
- **無 API 變更**：純前端 UI 調整
- **無依賴變更**：使用既有的 Shadcn 元件
