## Context

LexDraft 是台灣律師的法律書狀撰寫平台，準備上線。目前的使用流程：Login → CaseList → Create Case → Upload → AI 分析 → 生成書狀。缺乏引導機制，律師第一次進入看到空白畫面不知所措。

現有的引導雛形：
- `OnboardingUploadDialog` — 案件無檔案時自動彈出上傳提示
- `ChatPanel` 快捷按鈕 — 4 個常見操作
- 各 tab 有基本空狀態（icon + 一句話 + CTA）

相關檔案：
- `src/client/App.tsx` — routing（ProtectedRoute 包裹 CaseList、CaseWorkspace）
- `src/client/pages/CaseWorkspace.tsx` — workspace mount 時載入 7 組資料（API calls）
- `src/client/pages/CaseList.tsx` — 案件列表 + 空狀態
- `src/client/stores/useTabStore.ts` — `openFileTab` 從 API fetch PDF → blob URL
- `src/client/components/case/OnboardingUploadDialog.tsx` — 上傳引導 dialog
- `src/client/components/editor/EditorPanel.tsx` — editor 空狀態
- `src/client/components/analysis/DisputesTab.tsx` — 爭點空狀態
- `src/client/components/layout/sidebar/BriefsSection.tsx` — 書狀空狀態
- `src/client/components/layout/sidebar/FilesSection.tsx` — 檔案空狀態
- `src/client/components/analysis/TimelineTab.tsx` — 時間軸空狀態
- `src/client/components/layout/ChatPanel.tsx` — chat 空狀態（已有快捷按鈕，不改）
- `snapshots/z4keVNfyuKvL68Xg1qPl2-golden/` — golden snapshot（briefs + case + disputes）
- `.wrangler/state/v3/r2/lexdraft-files/blobs/` — 本地 R2 有 PDF 原檔

Demo 資料來源：DB case `z4keVNfyuKvL68Xg1qPl2`（車禍損害賠償），包含：
- 6 個 PDF（全部 ready，虛構文件）
- 2 個爭點 + 8 條不爭執事項
- 5 項損害賠償（合計 NT$423,700）
- 12 個時間軸事件
- 6 條法條引用
- 5 個證物（甲證一～五）
- 書狀用 golden snapshot 的 1 份（品質經 benchmark 驗證）

## Goals / Non-Goals

**Goals:**
- 律師不需登入即可透過 `/demo` 體驗完整 workspace（read-only）
- 每個空白畫面都 self-explanatory，告訴用戶「這裡會出現什麼」和「怎麼觸發」
- OnboardingUploadDialog 提供清楚的上傳指引和完成後銜接
- Demo case 的 PDF 可以正常開啟、縮放、引用定位

**Non-Goals:**
- 不做多案型 demo（只用一個車禍案）
- 不做互動式 demo（不能真的跑 AI pipeline）
- 不改 API / DB schema
- 不改 ChatPanel 空狀態（現有快捷按鈕已足夠）
- 不做 step-by-step modal wizard（用 contextual empty state 取代）

## Decisions

### D1: `isDemo` flag 放在 store 而非 URL 判斷

使用 `useCaseStore` 新增 `isDemo: boolean` flag。`/demo` route mount 時 set `true`，unmount 時清除。

**理由**：任何深層 component（TabStore、ChatPanel、Editor、sidebar sections）都能直接 `useCaseStore(s => s.isDemo)` 讀取，不需要層層傳 prop 或 useContext。

**替代方案**：
- URL 判斷（`useParams`）→ 放棄，深層 component 不方便取得
- React Context → 放棄，多一層 Provider 沒必要，store 已夠用

### D2: Demo route 複用 CaseWorkspace 而非新建 component

`/demo` route 使用同一個 `<CaseWorkspace />`，透過 `isDemo` flag 切換行為：
- `isDemo=true`：從 fixture hydrate stores，跳過所有 API calls
- `isDemo=false`：現行邏輯不動

**理由**：demo 要展示的就是「真正的 workspace 長什麼樣」，新建 component 會產生 UI 偏移且要維護兩份。

**具體差異**：

| 行為 | 正常模式 | Demo 模式 |
|------|---------|----------|
| 資料載入 | 7 個 API call | fixture hydrate |
| openFileTab | fetch `/api/files/:id/pdf` | `pdfUrl = /demo/${filename}` |
| Editor | `editable=true` | `editable=false` |
| Chat 送出 | 正常 | disabled |
| 上傳/刪除 | 正常 | disabled |
| OnboardingUploadDialog | 無檔案時彈出 | 不彈出 |
| 頂部 | 無 | CTA banner |

### D3: PDF 靜態載入方式

6 個 PDF 放 `public/demo/` 目錄，以原始檔名命名。`useTabStore.openFileTab` 加判斷：

```
if (isDemo) → pdfUrl = `/demo/${filename}`
else        → fetch(`/api/files/${fileId}/pdf`) → blob URL
```

**理由**：`FileViewer` 只認 `pdfUrl` prop，不在乎 URL 來源。靜態檔案支援所有現有功能（縮放、文字選取、citation highlight）。

### D4: Demo fixture 格式

單一 JSON 檔 `src/client/data/demo-fixture.ts`（TypeScript export），包含所有 store 需要的資料：

```typescript
export const DEMO_FIXTURE = {
  case: { ... },           // Case object
  files: [ ... ],          // CaseFile[]
  briefs: [ ... ],         // Brief[]（1 份）
  disputes: [ ... ],       // Dispute[]
  damages: [ ... ],        // Damage[]
  timeline: [ ... ],       // TimelineEvent[]
  undisputedFacts: [ ... ],// UndisputedFact[]
  lawRefs: [ ... ],        // LawRef[]
  exhibits: [ ... ],       // Exhibit[]
}
```

**理由**：TypeScript export 可以 tree-shake + type-check。比 JSON import 更容易維護。案件標題和 case_number 需要從測試名稱改為虛構正式名稱。

### D5: Read-only 實作策略

不做全域 mutation interceptor，而是在各 UI 入口加 `disabled`：

- Tiptap editor：`editable={!isDemo}`
- ChatPanel textarea + 送出按鈕：`disabled={isDemo}`
- 快捷按鈕（撰寫起訴狀等）：`disabled={isDemo}`
- FilesSection 上傳按鈕：隱藏
- DisputesTab 分析按鈕：隱藏
- TimelineTab 分析/新增按鈕：隱藏
- BriefsSection 新增按鈕：隱藏
- CaseInfoTab 所有欄位：`disabled`
- Tab 關閉按鈕：保留（可以關 tab 再從 sidebar 重開，不影響 store）

**理由**：入口點明確且有限（~10 處），逐一 disable 比全域攔截更可控、更好 review。

### D6: Demo 頂部 banner

在 CaseWorkspace 頂部（header bar 之上或之內）加一個 accent 色 banner：

```
┌──────────────────────────────────────────────────────────┐
│  📋 這是範例案件 — 查看 AI 產出的書狀、爭點分析與時間軸    [建立我的案件 →]  │
└──────────────────────────────────────────────────────────┘
```

點擊 CTA 跳轉到 `/login`。banner 固定顯示不可關閉。

### D7: Empty state 設計原則

每個空狀態包含三層資訊：

1. **是什麼**：這個區域的用途（一句話）
2. **會看到什麼**：AI 會產出的內容描述（bullet points 或 mini preview）
3. **怎麼觸發**：CTA 按鈕 + 前置條件提示（如「需先上傳案件文件」）

不需要 mini preview 的地方（書狀、檔案、editor）只用 1 + 3。

### D8: OnboardingUploadDialog 改為兩階段

**階段一（上傳中）**：
- 標題不變
- 描述改為：「上傳對方書狀、證據或判決等文件」
- 新增 3 bullet points 說明 AI 會做什麼
- Drop zone + file list 不變

**階段二（上傳完成後）**：
- 上傳全部完成 → dialog 內容切換
- 顯示「已上傳 N 個檔案」+ 「AI 正在處理中...」
- 引導下一步：「在左側對話框選擇要撰寫的書狀類型」
- 按鈕改為「開始使用」

觸發條件：`uploads.length > 0 && !uploading && uploads.every(u => u.status !== 'uploading')`

## Risks / Trade-offs

- **Demo fixture 大小**：1 份書狀的 `content_structured` JSON 約 100KB，加上其他資料約 120KB。打包進 JS bundle 可接受，但建議 lazy import（`import()`）避免影響首屏。
- **PDF 靜態檔案大小**：6 個虛構 PDF 放 `public/demo/`，預估 ~500KB 總計。用戶訪問 `/demo` 點開檔案時才下載，不影響其他頁面。
- **Demo 資料 schema 同步**：如果未來改了 store 的資料結構（如 Brief type），demo fixture 也要同步更新。可以靠 TypeScript 型別檢查自動抓到。
- **Empty state 文案佔用 sidebar 空間**：爭點 tab 的 mini preview 在 352px 寬的 sidebar 裡需要控制好排版，避免過於擁擠。
