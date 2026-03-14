## Overview

在 RightSidebar 的 tab 標籤上顯示 badge 數字，提示使用者有多少新檔案尚未納入爭點/時間軸分析。進入 tab 後顯示 inline banner 提供詳細資訊。

## Requirements

### DB Schema

- `cases` 表新增 `disputes_analyzed_at TEXT` nullable 欄位
- `cases` 表新增 `timeline_analyzed_at TEXT` nullable 欄位
- 值為 ISO 8601 UTC string，null 表示從未分析過

### Backend — 寫入 timestamp

- `analysisService.ts` 的 `runDeepDisputeAnalysis` 成功後，更新 `cases.disputes_analyzed_at = new Date().toISOString()`
- `analysisService.ts` 的 timeline 分析成功後，更新 `cases.timeline_analyzed_at = new Date().toISOString()`
- timestamp 在 DB persist 完成後（disputes/timeline 寫入 DB 後）才更新

### Backend — 回傳 timestamp

- `GET /api/cases/:caseId` 回傳的 case 物件包含 `disputes_analyzed_at` 和 `timeline_analyzed_at`
- 分析 API `POST /api/cases/:caseId/analyze` 的 response 也回傳更新後的 `analyzed_at` 值

### Frontend — useCaseStore

- `CurrentCase` type 新增 `disputes_analyzed_at: string | null` 和 `timeline_analyzed_at: string | null`
- 分析完成後（`runAnalysis` in `useAnalysisStore`）更新 `currentCase` 的對應 timestamp

### Frontend — newFileCount 計算

- derived selector：計算 `files.filter(f => f.status === 'ready' && analyzed_at && f.created_at > analyzed_at).length`
- `analyzed_at` 為 null 時回傳 0（從未分析 → 不顯示 badge）
- 分別計算 disputes 和 timeline 的 count

### Frontend — Tab Badge

- `RightSidebar.tsx` 的 tab 標籤旁顯示 badge 數字
- 只有 `爭點` 和 `時間軸` tab 有 badge
- `count > 0` 時顯示，`count === 0` 時不顯示
- Badge 樣式：小圓形背景 + 數字，使用 accent color

### Frontend — Inline Banner

- 爭點 tab（`DisputesTab.tsx`）頂部顯示 banner：「N 個新檔案尚未納入分析」
- 時間軸 tab（`TimelineTab.tsx`）頂部顯示同樣 banner
- Banner 包含「重新分析」按鈕（觸發 `runAnalysis`）
- 只在 `count > 0` 且已有分析結果時顯示

## Acceptance Criteria

- [ ] 上傳新檔案並處理完成後，爭點和時間軸 tab 標籤出現 badge 數字
- [ ] Badge 數字正確反映新檔案數量
- [ ] 點擊重新分析後，badge 消失
- [ ] 關閉瀏覽器重新開啟，badge 仍正確顯示（持久化）
- [ ] 從未分析過的案件不顯示 badge（走 empty state 流程）
- [ ] 刪除檔案不影響 badge 數字（不增加也不產生負數）
