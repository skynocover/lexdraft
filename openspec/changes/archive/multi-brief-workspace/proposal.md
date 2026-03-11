## Why

LexDraft 同一案件會產生多份書狀（起訴狀 + 答辯狀 + 準備書狀），但目前前端只能同時持有一份書狀的完整內容（`useBriefStore.currentBrief` singleton）。切換書狀 tab 時觸發 API call 重新載入、undo/redo 歷史消失、Pipeline 寫入非 active brief 的 SSE 事件被 drop。律師在同一案件的多份書狀間來回工作時體驗斷裂。

## What Changes

- `useBriefStore` 從 singleton `currentBrief` 改為 `briefCache: Map<string, PerBriefState>`，每份已開啟的書狀各自保存完整內容、dirty 狀態、undo/redo 歷史
- `sseHandlers.ts` 的 `brief_update` 路由改為更新 `briefCache` 中對應 `brief_id` 的書狀，不再依賴 `currentBrief` 比對
- `useChatStore` 的 `briefContext` 改為送 focused panel 的 active brief，同時附帶所有已存在書狀的 metadata
- `A4PageEditor` 改為從 `briefCache` 按 `briefId` 讀取，支援 split view（兩個 panel 各顯示一份書狀）
- `useAutoSave` 改為切 tab 時立即存 dirty brief + 定期掃描所有 dirty briefs
- Tab system（`useTabStore`）的 `syncActiveTabStore` 簡化為只設 `activeBriefId`，不再觸發 API call

### 不做的事

- **不改後端** — 所有改動限於前端 store 和 UI 層
- **不改 DB schema** — briefs 表結構不變
- **不做「書狀比對 diff」** — 那是 P3-3，split view 只是並排顯示

## Capabilities

### New Capabilities

- `brief-cache-store`: `useBriefStore` 從 singleton 改為 per-brief cache，支援多書狀同時在記憶體中保持完整狀態（內容、dirty、undo/redo）
- `sse-brief-routing`: SSE `brief_update` 事件路由到 `briefCache` 中對應的 brief，Pipeline 可在背景更新非 active brief
- `chat-context-awareness`: Chat 送出時附帶所有已存在書狀的 metadata（`allBriefs`），讓 Agent 知道案件有哪些書狀
- `split-view-support`: A4PageEditor 支援從 `briefCache` 按 briefId 讀取，搭配現有 split panel 機制實現並排檢視

### Modified Capabilities

- `useAutoSave` hook 改為支援 per-brief dirty 追蹤
- `useTabStore.syncActiveTabStore` 簡化為設 `activeBriefId`

## Impact

- `src/client/stores/useBriefStore.ts` — 核心重構：singleton → cache
- `src/client/stores/sseHandlers.ts` — brief_update 路由改用 cache
- `src/client/stores/useChatStore.ts` — briefContext 改讀 cache + 附帶 allBriefs
- `src/client/stores/useTabStore.ts` — syncActiveTabStore 簡化
- `src/client/hooks/useAutoSave.ts` — per-brief dirty 掃描
- `src/client/components/editor/tiptap/A4PageEditor.tsx` — 改讀 briefCache
- `src/client/components/editor/tiptap/EditorToolbar.tsx` — dirty/saving 改讀 cache
- `src/client/components/layout/sidebar/BriefsSection.tsx` — dirty badge 顯示
