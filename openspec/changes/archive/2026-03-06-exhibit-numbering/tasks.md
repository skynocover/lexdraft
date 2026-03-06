# Tasks: 證物編號系統

## Phase 1: 資料層 + 自動分配

### Task 1.1: DB Schema + Migration
- [x] 在 `src/server/db/schema.ts` 新增 `exhibits` 表定義（case_id FK, file_id FK, prefix, number, doc_type, description）
- [x] `npm run db:generate` 生成 migration
- [x] `npm run db:migrate:local` 套用到本地 D1
- [x] 驗證 table 結構

### Task 1.2: 自動分配邏輯
- [x] 建立 `src/server/lib/exhibitAssign.ts`
- [x] 實作 `getExhibitPrefix(clientRole, fileCategory)` — prefix 決定矩陣
- [x] 實作 `assignExhibits(paragraphs, clientRole, files, existingExhibits)` — 掃描 citations，跳過已有編號的 file，接續編號
- [x] 實作 `deriveExhibitDescription(fileSummary)` — 從 summary 截取第一句

### Task 1.3: Pipeline 整合
- [x] 在 pipeline Step 3 完成後呼叫 `assignExhibits()`
- [x] 將新 exhibits 寫入 DB
- [x] 發送 SSE event `{ action: 'set_exhibits', data: exhibits }`

## Phase 2: API

### Task 2.1: Exhibits CRUD Route
- [x] 建立 `src/server/routes/exhibits.ts`
- [x] `GET /api/cases/:caseId/exhibits` — 列表（按 prefix + number 排序）
- [x] `POST /api/cases/:caseId/exhibits` — 手動新增
- [x] `PATCH /api/cases/:caseId/exhibits/:id` — 更新單一 exhibit
- [x] `PATCH /api/cases/:caseId/exhibits/reorder` — 同 prefix 內重新排序
- [x] `DELETE /api/cases/:caseId/exhibits/:id` — 刪除 + 同 prefix 重新編號
- [x] 在 `src/index.ts` 掛載 route

## Phase 3: Frontend

### Task 3.1: Store + Render-time mapping
- [x] `useBriefStore` 新增 `exhibits` state、CRUD actions、`exhibitMap()` computed
- [x] `useChatStore` SSE handler 處理 `set_exhibits` event
- [x] 載入 case 時一併 fetch exhibits

### Task 3.2: Citation 顯示注入 exhibit mapping
- [x] `CitationNodeView.tsx` — popover header 用 `exhibitMap.get(fileId) || label`
- [x] `CitationReviewModal.tsx` — 同上
- [x] `exportDocx.ts` — 匯出時用 exhibitMap 替換 file citation labels

### Task 3.3: ExhibitsTab 元件
- [x] 建立 `src/client/components/analysis/ExhibitsTab.tsx`
- [x] 按 prefix 分組顯示
- [x] 拖放排序 → reorder API
- [x] 行內編輯 doc_type、description
- [x] 刪除 + 新增（file picker）
- [x] 掛載到 analysis panel

### Task 3.4: 證物清單匯出
- [x] 「匯出證物清單」按鈕
- [x] 組裝資料：exhibits + files（filename, doc_date）
- [x] 純文字表格 → 複製到剪貼簿
