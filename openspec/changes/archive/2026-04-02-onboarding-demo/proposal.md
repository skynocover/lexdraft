## Why

LexDraft 準備上線，但目前缺乏引導機制。律師第一次進入系統看到空白的 workspace，不知道工具能產出什麼品質的成品，也不知道下一步該做什麼。對律師來說，在看到成品之前就被要求上傳案件資料（含機密），心理門檻很高。

核心問題：**信任落差** — 律師需要先看到成品，才願意投入自己的案件。

## What Changes

### Demo Case（pre-login，零摩擦體驗）
- 新增 `/demo` route，不需要登入即可訪問
- 從靜態 JSON fixture hydrate 所有 store（case、files、briefs、disputes、damages、timeline、lawRefs、exhibits）
- 6 個虛構 PDF 放 `public/demo/`，靜態載入不打 API
- Workspace 為 read-only：editor 不可編輯、chat 不可送出、上傳/刪除等 mutation 全部 disabled
- 頂部固定 banner 引導「建立你的第一個案件」→ 跳轉 `/login`
- 書狀展示 1 份（從 golden snapshot 選品質最好的）

### Empty State 改善（8 個空狀態）
- **CaseList**：3 步驟說明 + 「查看範例案件」CTA
- **Editor Panel**：說明每種內容從哪裡開啟
- **爭點 tab**：說明 AI 會產出什麼 + mini preview 範例
- **卷宗 — 書狀**：指向 ChatPanel 快捷按鈕
- **卷宗 — 檔案**：補充說明上傳什麼類型的文件
- **時間軸 tab**：說明會產出什麼 + 前置條件提示

### OnboardingUploadDialog 調整
- 文案改進：告訴律師上傳什麼（對方書狀、證據、判決）+ AI 會做什麼（3 bullet points）
- 上傳完成後：dialog 內容切換為「下一步」引導，而非直接關閉
- 「稍後再說」不再是死路 — 由改善後的 empty state 接住用戶

## Capabilities

### New Capabilities
- `demo-case`: Pre-login 範例案件 — `/demo` route + fixture hydration + read-only workspace + 頂部 CTA banner
- `empty-states`: 各面板空狀態引導 — 教育性文案 + 行動指引 + mini preview

### Modified Capabilities
- `onboarding-upload`: OnboardingUploadDialog 文案改進 + 完成後銜接畫面

## Impact

- **前端新增**：`/demo` route、fixture JSON、`public/demo/*.pdf`、`isDemo` store flag
- **前端修改**：`App.tsx`、`CaseWorkspace.tsx`、`useTabStore.ts`、`CaseList.tsx`、`EditorPanel.tsx`、`DisputesTab.tsx`、`BriefsSection.tsx`、`FilesSection.tsx`、`TimelineTab.tsx`、`OnboardingUploadDialog.tsx`、`ChatPanel.tsx`
- **無 API 變更**：純前端
- **無 DB 變更**：demo 資料從 fixture 載入，不寫 DB
