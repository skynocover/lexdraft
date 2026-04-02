## Overview

Pre-login 範例案件。律師不需登入即可透過 `/demo` 體驗完整的 read-only workspace。

## Requirements

### Routing
- `/demo` route 在 `ProtectedRoute` 之外，不需要 auth token
- 使用同一個 `CaseWorkspace` component，透過 `isDemo` flag 切換行為
- 離開 `/demo`（navigating away）時清除 demo state

### State Management
- `useCaseStore` 新增 `isDemo: boolean` flag（預設 `false`）
- `isDemo = true` 時，CaseWorkspace 跳過所有 API calls，改從 fixture hydrate：
  - `useCaseStore`: `currentCase`, `files`
  - `useBriefStore`: `briefs`, `lawRefs`
  - `useAnalysisStore`: `disputes`, `damages`, `timeline`, `undisputedFacts`
  - `useTabStore`: 自動開啟 1 份書狀 tab
- `isDemo = true` 時不載入 chat history、不觸發 OnboardingUploadDialog

### Fixture Data
- 來源：DB case `z4keVNfyuKvL68Xg1qPl2`（車禍損害賠償虛構案件）
- 格式：`src/client/data/demo-fixture.ts`（TypeScript export）
- 案件標題改為正式虛構名稱（如「陳美玲 v. 王建宏 損害賠償事件」）
- case_number 補完整（如「114年度訴字第1234號」）
- 書狀 1 份（golden snapshot 中選品質最佳的）
- 其餘資料（disputes, damages, timeline, files metadata, lawRefs, exhibits）從 DB 導出，不修改

### PDF 靜態載入
- 6 個 PDF 放 `public/demo/` 目錄，以原始檔名命名
- `useTabStore.openFileTab`：`isDemo` 時 `pdfUrl = /demo/${filename}`，跳過 API fetch
- FileViewer 的所有功能（縮放、文字選取、citation highlight）正常運作

### Read-only 模式
- Tiptap editor：`editable=false`
- ChatPanel：textarea + 送出按鈕 + 快捷按鈕 disabled
- FilesSection：隱藏上傳按鈕
- DisputesTab：隱藏分析按鈕
- TimelineTab：隱藏分析/手動新增按鈕
- BriefsSection：隱藏新增按鈕
- CaseInfoTab：所有欄位 disabled
- Tab 關閉/拖曳：保留（不影響 store 持久化）

### CTA Banner
- Workspace 頂部固定 banner（accent 色背景）
- 文案：「這是範例案件 — 查看 AI 產出的書狀、爭點分析與時間軸」
- CTA 按鈕：「建立我的案件」→ navigate `/login`
- Banner 不可關閉

## Edge Cases
- 用戶直接訪問 `/demo` → 正常顯示，不 redirect 到 login
- 已登入用戶訪問 `/demo` → 正常顯示 demo（不因為有 token 就跳過）
- 用戶從 `/demo` 點 CTA → 跳轉 `/login`，demo state 清除
- 瀏覽器重新整理 `/demo` → 重新 hydrate fixture，正常顯示
