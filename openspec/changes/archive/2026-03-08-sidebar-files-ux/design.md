## Context

卷宗檔案側邊欄（`RightSidebar` → `CaseMaterialsContent`）包含三個 section：書狀草稿、案件卷宗、法條引用。其中案件卷宗的 file item（`FileItem.tsx`）和群組結構（`FilesSection.tsx`）有多項 UI 細節需要打磨。

主要元件：
- `FileItem.tsx` — 單一檔案 row（badge、filename、date、doc_type select、delete）
- `FilesSection.tsx` — 檔案分群（甲方證物、乙方證物、未編號）+ DnD 排序
- `categoryConfig.ts` — category badge 設定

## Goals / Non-Goals

**Goals:**
- 日期顯示符合法律文件慣例（民國年）
- 移除不必要的 UI 元素（未編號 item 的 drag handle spacer）
- 提升互動元素的可發現性（category badge、doc_type selector）
- 改善空狀態引導
- 統一 dark theme 風格

**Non-Goals:**
- 法條引用分組（明確排除）
- Compact mode / 空間壓縮（明確排除）
- 書狀 badge icon 調整（明確排除）
- 任何後端 API 變更

## Decisions

### 1. 民國年轉換 — 共用 utility function

建立 `formatROCDate(dateStr: string): string` 放在 `src/client/lib/dateUtils.ts`。公式：`民國年 = 西元年 - 1911`。

格式：`113-10-12`（無前綴「民國」，因為在法律文件列表中民國年是預設，不需標註）。

輸入可能是 `2024-10-12` 或 `114-02-18`（已經是民國年格式）。需處理已經是民國年的情況（年份 < 200 時視為已是民國年，直接回傳）。

### 2. Drag handle spacer — 條件式渲染

`FileItem.tsx` 目前：有 exhibit 時顯示 `GripVertical`，沒有時顯示 `<span className="w-3.5 shrink-0" />`。

改為：沒有 `dragHandleProps` 時完全不渲染 handle 區域，讓 badge 靠左。

### 3. 「未編號」→「其他文件」

`FilesSection.tsx:191` 的 label 從「未編號」改為「其他文件」。語意更清楚：這些文件不是「待編號」而是「不需要證物編號」的文件（法院來文、其他參考資料等）。

### 4. 影本 select — Shadcn Popover

原生 `<select>` 改為 Shadcn `Popover` + 按鈕列表，與 category badge popover 的交互模式一致。三個選項（影本/正本/繕本）用小型 popover 呈現。

選擇 Popover 而非 Shadcn Select 的原因：只有 3 個選項、不需要搜尋功能、與現有 category popover 風格一致。

### 5. Category badge hover — ring + cursor 暗示

Badge 已有 `hover:ring-2 hover:ring-current/25`，但不夠明顯。加上 `hover:brightness-125` 或更顯著的 ring。保持簡單，不加額外 icon overlay。

### 6. Empty state — 整合現有 FileUploadButton

空狀態從純文字「尚無檔案」改為帶 icon + 文字 + 上傳按鈕的引導區域。上傳邏輯複用 `FileUploadButton` 的 `handleUpload`，但 UI 展示為更大的 CTA 區域。

### 7. Tooltip — 原生 title attribute

使用 HTML `title` attribute 而非 Shadcn Tooltip。原因：檔案列表可能有 20+ 項，為每個掛 Tooltip 元件會增加不必要的 DOM 複雜度。`title` 足夠滿足「hover 看全名」的需求。

## Risks / Trade-offs

- **民國年判斷**：年份 < 200 的啟發式判斷可能在極端情況下誤判。但實務上法律文件日期不會早於民國元年 (1912)，風險極低。
- **影本 Popover**：比原生 select 多一層 DOM，但只在點擊時掛載，效能影響可忽略。
