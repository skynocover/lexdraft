## 1. Utility

- [x] 1.1 建立 `src/client/lib/dateUtils.ts`，實作 `formatROCDate(dateStr: string): string`（西元→民國年轉換，年份 < 200 原樣回傳）

## 2. FileItem.tsx 修改

- [x] 2.1 日期顯示改用 `formatROCDate()`
- [x] 2.2 移除非 exhibit item 的 drag handle spacer（無 `dragHandleProps` 時不渲染 handle 區域）
- [x] 2.3 影本 `<select>` 改為 Shadcn Popover（三選項：影本/正本/繕本）
- [x] 2.4 Category badge hover 加強視覺回饋（ring + brightness）
- [x] 2.5 檔名 `<p>` 加上 `title={file.filename}` tooltip

## 3. FilesSection.tsx 修改

- [x] 3.1 「未編號」label 改為「其他文件」
- [x] 3.2 空狀態改為帶 icon + 引導文字 + 上傳 CTA 按鈕

## 4. 驗證

- [x] 4.1 Type check (`npx tsc --noEmit`)
- [x] 4.2 Prettier format
