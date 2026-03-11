## 1. useBriefStore 核心重構

- [x] 1.1 定義 `PerBriefState` interface（brief, dirty, saving, _history, _future）
- [x] 1.2 將 `currentBrief`, `dirty`, `saving`, `_history`, `_future` 替換為 `activeBriefId: string | null` + `briefCache: Record<string, PerBriefState>`（保留 backward-compat aliases）
- [x] 1.3 新增 helper 函式 `resolveId`, `getCached`, `aliasesFor`, `patchCache`, `pushHistory`, `freshBriefState`
- [x] 1.4 改寫 `loadBrief(briefId)` — cache hit 時只設 `activeBriefId`，cache miss 才打 API 並存入 cache，切換前自動存 dirty brief
- [x] 1.5 改寫 `setCurrentBrief()` — 將 brief 存入 cache 並設為 active（保留原名以減少 SSE handler 改動）
- [x] 1.6 改寫 `setContentStructured()` — 接受 briefId 參數，操作 `briefCache[briefId]`
- [x] 1.7 改寫 paragraph 操作（`addParagraph`, `updateParagraph`, `removeParagraph`）— 接受 briefId 參數
- [x] 1.8 改寫 citation 操作（`updateCitationStatus`, `removeCitation`）— 接受 briefId 參數
- [x] 1.9 改寫 `undo(briefId?)` / `redo(briefId?)` — 操作指定 brief 的 history
- [x] 1.10 改寫 `saveBrief(briefId?)` — 從 cache 讀取指定 brief 存檔
- [x] 1.11 改寫 `deleteBrief(briefId)` — 同時從 `briefs[]` 和 `briefCache` 移除
- [x] 1.12 改寫 `setTitle(title, briefId?)` — 更新 cache 中的 brief title
- [x] 1.13 新增 `clearBriefCache()` — 清空 briefCache（供 `clearTabs` 呼叫）
- [x] 1.14 改寫 `syncExhibitLabels()` — 遍歷所有 cache 中的 briefs 更新 exhibit labels
- [x] 1.15 確認 `npx tsc --noEmit` 通過 ✓

## 2. SSE Handler 路由改寫

- [x] 2.1 `sseHandlers.ts` — `create_brief` action 不需改（`setCurrentBrief` 已自動存入 cache + 設 active）
- [x] 2.2 `sseHandlers.ts` — `add_paragraph` action 改為：用 `event.brief_id` 查找 `briefCache`，呼叫 `addParagraphTo(briefId, p)`
- [x] 2.3 `sseHandlers.ts` — `update_paragraph` action 改為：呼叫 `updateParagraphIn(briefId, p)`
- [x] 2.4 `useBriefStore` — 新增 `addParagraphTo(briefId, paragraph)` 和 `updateParagraphIn(briefId, paragraph)` 方法
- [x] 2.5 確認 `set_law_refs`, `set_exhibits` 等 case-level action 不受影響 ✓

## 3. useTabStore 整合

- [x] 3.1 `syncActiveTabStore()` — brief tab 時呼叫 `loadBrief(briefId)`（cache-aware，不一定打 API）
- [x] 3.2 auto-save 邏輯放在 `loadBrief()` 中：切換到不同 brief 前自動存 dirty brief
- [x] 3.3 `focusPanel()` — 已透過 `syncActiveTabStore` → `loadBrief` 自動更新 `activeBriefId`
- [x] 3.4 `clearTabs()` — 呼叫 `useBriefStore.getState().clearBriefCache()`

## 4. A4PageEditor + EditorToolbar 改讀 cache

- [x] 4.1 `A4PageEditor` — props 改為接收 `briefId: string`，從 `briefCache[briefId]` 讀取 brief、dirty、saving
- [x] 4.2 `A4PageEditor` — `useAutoSave()` 改為 `useAutoSave(briefId)`
- [x] 4.3 `A4PageEditor` — paragraph 操作（updateParagraph, removeParagraph 等）帶入 briefId
- [x] 4.4 `A4PageEditor` — setTitle 帶入 briefId
- [x] 4.5 `EditorToolbar` — dirty/saving props 由外層傳入（已從 cache 讀取）
- [x] 4.6 `EditorPanel` — 渲染 brief tab 時傳 `briefId` prop 給 `A4PageEditor`
- [x] 4.7 `useAutoSave(briefId)` — 監聽 `briefCache[briefId]?.dirty`，trigger saveBrief(briefId)

## 5. Chat Context 擴充

- [x] 5.1 `src/shared/types.ts` — `ChatRequest` 新增 `allBriefs?: { id: string; title: string | null; template_id: string | null }[]`
- [x] 5.2 `useChatStore.ts` — `sendMessage()` 改從 `briefCache[activeBriefId]` 讀取 `briefContext`
- [x] 5.3 `useChatStore.ts` — `sendMessage()` 附帶 `allBriefs` metadata
- [x] 5.4 `src/server/routes/chat.ts` — 接收 `allBriefs` 並傳遞給 AgentDO
- [x] 5.5 `AgentDO.ts` — system prompt 新增已有書狀列表段落

## 6. Sidebar + UI 補完

- [x] 6.1 `BriefsSection.tsx` — brief 列表項目顯示 dirty 小圓點（從 `briefCache` 讀取）
- [x] 6.2 `BriefsSection.tsx` — active brief 高亮顯示（`activeBriefId` 比對）

## 7. 驗證

- [x] 7.1 `npx tsc --noEmit` 通過
- [ ] 7.2 手動測試：開兩個 brief tab → 來回切換 → 內容正確、undo/redo 保留
- [ ] 7.3 手動測試：Pipeline 寫 Brief A → 看 Brief B → 切回 A → 段落已更新
- [ ] 7.4 手動測試：Split view — Brief A 在左 panel、Brief B 在右 panel → 各自顯示正確
- [ ] 7.5 手動測試：編輯 Brief A → dirty → 切到 B → 切回 A → 已自動存
- [ ] 7.6 手動測試：chat 送訊息 → 確認 `allBriefs` 有在 request body 中
- [x] 7.7 prettier format 完成
