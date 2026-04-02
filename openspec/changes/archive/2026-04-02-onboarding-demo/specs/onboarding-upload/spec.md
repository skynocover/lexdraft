## Overview

改善 OnboardingUploadDialog 的文案和完成後的銜接體驗。

## Requirements

### 階段一：上傳階段（改善文案）

**DialogHeader 修改：**
- 標題不變：「上傳案件文件」
- 描述改為：
  ```
  上傳對方書狀、證據或判決等文件。AI 會自動：
  • 摘要每份文件重點
  • 歸納雙方爭點
  • 生成書狀時引用原文
  ```
- 3 bullet points 用 `text-t2` 小字體，建立上傳動機

**其餘不變**：drop zone、file list、「稍後再說」按鈕、檔案驗證邏輯。

### 階段二：上傳完成後的銜接

**觸發條件**：`uploads.length > 0 && !uploading && uploads.every(u => u.status !== 'uploading')`

**Dialog 內容切換為**：
- 上方：成功訊息「已上傳 N 個檔案」（N 為 `status === 'done'` 的數量）
- 中間：「AI 正在處理文件中...」（`text-t3`）
- 下方：引導文字「你可以在左側對話框選擇要撰寫的書狀類型，或等文件處理完再操作」
- 按鈕：「開始使用」（primary，關閉 dialog）

**若有上傳失敗**：仍顯示 file list（保留 error 狀態），「開始使用」按鈕改為「完成」。

### 「稍後再說」行為

- 行為不變：關閉 dialog，`onboardingShownForRef` 防止再次彈出
- 依靠 empty-states spec 的改善來接住這些用戶（FilesSection 空狀態提供上傳入口）
- 不做額外的「再次顯示」機制

## Edge Cases
- 用戶上傳 0 個有效檔案（全部 rejected）→ 停留在階段一
- 用戶上傳後全部失敗 → 顯示 file list with errors + 「完成」按鈕
- 用戶上傳部分成功部分失敗 → 顯示混合狀態 + 「完成」按鈕
