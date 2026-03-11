## SSE Brief Routing

### Requirements

1. `sseHandlers.ts` 的 `handleBriefUpdate()` 中，`add_paragraph` 和 `update_paragraph` 改為：用 `event.brief_id` 查找 `briefCache`，找到就更新，找不到就忽略
2. `create_brief` 事件：建立新 brief 後加入 `briefCache`（dirty=false），開 tab，設為 `activeBriefId`
3. 移除 `!event.brief_id || briefStore.currentBrief?.id === event.brief_id` 的比對邏輯
4. `useBriefStore` 新增 `addParagraphTo(briefId, paragraph)` 和 `updateParagraphIn(briefId, paragraph)` 方法供 SSE handler 呼叫

### Constraints

- `set_disputes`, `set_damages`, `set_timeline`, `set_parties`, `set_claims` 維持 case-level（寫入 `useAnalysisStore`，不受多書狀影響）
- `set_law_refs`, `set_exhibits` 維持 case-level（寫入 `useBriefStore` 的 case-level 欄位）

### Acceptance Criteria

- Pipeline 寫入 Brief A 的段落 → 用戶正在看 Brief B → A 在 cache 中正確更新 → 切到 A tab 顯示最新內容
- Pipeline 寫入未開啟的 brief（briefCache 不含該 id）→ 事件被安全忽略，不 crash
