## Why

律師上傳新檔案後，爭點分析和時間軸不會自動重新分析。目前 UI 沒有任何提示告知使用者「分析結果可能已過時」，使用者必須自己記得要切到爭點 tab 按重新分析。尤其檔案上傳在「卷宗」tab，分析按鈕在「爭點」和「時間軸」tab，跨 tab 的資訊斷層讓使用者很容易忘記。

## What Changes

- **DB**: `cases` 表新增 `disputes_analyzed_at` 和 `timeline_analyzed_at` 兩個 timestamp 欄位
- **Backend**: 分析完成時寫入對應 timestamp；GET cases API 回傳這兩個欄位
- **Frontend**: RightSidebar 的 tab 標籤上顯示 badge 數字（新檔案數），爭點 tab 內顯示 inline banner 列出新檔案

## Capabilities

### New Capabilities
- `stale-analysis-badge`: Sidebar tab 標籤上的 badge 數字提示 + 爭點/時間軸 tab 內的 inline banner，告知使用者有多少新檔案尚未納入分析

### Modified Capabilities
- `direct-analysis-api`: 分析完成時更新 `*_analyzed_at` timestamp

## Impact

- **DB Schema**: `cases` 表新增 2 個 nullable text 欄位（`disputes_analyzed_at`、`timeline_analyzed_at`），需要 migration
- **Backend**: 修改 `analysisService.ts`（分析完成寫 timestamp）、修改 cases route（回傳新欄位）
- **Frontend**: 修改 `RightSidebar.tsx`（tab badge）、修改 `DisputesTab.tsx` 和 `TimelineTab.tsx`（inline banner）、修改 `useCaseStore.ts`（存 timestamp + 計算 newFileCount）
- **依賴**: 無新增依賴
