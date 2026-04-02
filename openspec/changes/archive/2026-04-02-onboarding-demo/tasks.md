## Tasks

### Preparation

- [x] 1. 從 DB + golden snapshot 導出 demo fixture 資料
  - 從 DB 導出：case metadata, files metadata, disputes, damages, timeline, lawRefs, exhibits
  - 從 golden snapshot 選 1 份最佳書狀（比較 4 份的 citation 數量和內容品質）
  - 修改案件標題（正式虛構名稱）、補完整 case_number
  - 輸出為 `src/client/data/demo-fixture.ts`（typed export）

- [x] 2. 從本地 R2 導出 6 個 PDF 到 `public/demo/`
  - 寫腳本：根據 files table 的 r2_key 從 `.wrangler/state/v3/r2/` 找到對應 blob，複製並重命名為原始檔名
  - 確認 6 個 PDF 都能正常開啟

### Demo Case

- [x] 3. `useCaseStore` 新增 `isDemo` flag
  - 新增 `isDemo: boolean`（預設 false）
  - 新增 `setIsDemo(val: boolean)` action
  - `clearCase()` 時重設為 false

- [x] 4. `/demo` route + CaseWorkspace demo mode
  - `App.tsx` 新增 `/demo` route（不在 ProtectedRoute 內）
  - `CaseWorkspace.tsx`：偵測 `/demo` path → set `isDemo=true` + hydrate stores from fixture
  - 跳過所有 API calls（loadCase, loadFiles, loadBriefs, loadDisputes, loadDamages, loadLawRefs, loadTimeline, loadHistory）
  - 自動開啟書狀 tab
  - unmount 時清除 demo state

- [x] 5. `useTabStore.openFileTab` demo mode 支援
  - `isDemo` 時：`pdfUrl = /demo/${filename}`，跳過 API fetch
  - 正常模式不受影響

- [x] 6. Read-only 機制
  - Tiptap editor：`editable={!isDemo}`
  - ChatPanel：textarea、送出按鈕、快捷按鈕 disabled
  - FilesSection：隱藏上傳按鈕
  - DisputesTab：隱藏 EmptyAnalyzeButton 和 reanalyze
  - TimelineTab：隱藏分析/手動新增按鈕
  - BriefsSection：隱藏新增按鈕
  - CaseInfoTab：所有欄位 disabled

- [x] 7. Demo CTA banner
  - CaseWorkspace 頂部固定 banner（`isDemo` 時顯示）
  - 文案 +「建立我的案件」按鈕 → navigate `/login`

### Empty States

- [x] 8. CaseList 空狀態改善
  - 三步驟流程說明
  - 「新建案件」+「查看範例案件」雙 CTA

- [x] 9. Editor Panel 空狀態改善
  - 列出三種可開啟內容 + 來源位置

- [x] 10. 爭點 tab 空狀態改善
  - 說明文字 + 3 bullet points
  - Mini preview 卡片
  - 條件提示（需先上傳文件）

- [x] 11. 卷宗 — 書狀 + 檔案空狀態改善
  - 書狀：指向 ChatPanel 快捷按鈕
  - 檔案：行動導向文案 + 說明上傳什麼

- [x] 12. 時間軸 tab 空狀態改善
  - 說明文字 + 副文字
  - 條件提示（需先上傳文件）

### OnboardingUploadDialog

- [x] 13. 階段一文案改進
  - 描述改為具體指引 + 3 bullet points

- [x] 14. 階段二完成後銜接
  - 上傳完成後 dialog 內容切換
  - 成功訊息 + 處理中提示 + 下一步引導
  - 「開始使用」按鈕

### Verification

- [x] 15. 手動測試
  - `/demo` 路徑可直接訪問（不需登入）
  - Demo workspace 所有 tab 資料正確顯示
  - PDF 可以正常開啟、縮放、citation highlight
  - 所有 mutation 操作確實 disabled
  - CTA banner 正確跳轉到 /login
  - 各 empty state 文案正確顯示
  - OnboardingUploadDialog 兩階段流程正常
  - 正常模式（非 demo）所有功能不受影響
