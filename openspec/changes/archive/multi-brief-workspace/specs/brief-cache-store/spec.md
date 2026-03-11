## Brief Cache Store

### Requirements

1. `useBriefStore` 移除 `currentBrief: Brief | null`，改為 `activeBriefId: string | null` + `briefCache: Record<string, PerBriefState>`
2. `PerBriefState` 包含：`brief: Brief`, `dirty: boolean`, `saving: boolean`, `_history: ContentSnapshot[]`, `_future: ContentSnapshot[]`
3. 所有原本操作 `currentBrief` 的方法（`setContentStructured`, `addParagraph`, `updateParagraph`, `removeParagraph`, `updateCitationStatus`, `removeCitation`）改為接受 `briefId` 參數，操作 `briefCache[briefId]`
4. 提供 `getActiveBrief(): Brief | null` 和 `getActiveBriefState(): PerBriefState | null` helper
5. `loadBrief(briefId)` 優先從 `briefCache` 讀取（cache hit → 不打 API），cache miss 才呼叫 API 並存入 cache
6. `saveBrief(briefId?)` 存指定 brief（預設 activeBriefId），只在 `dirty=true && saving=false` 時執行
7. `undo(briefId?)` / `redo(briefId?)` 操作指定 brief 的 `_history` / `_future`
8. `clearBriefCache()` 清空所有 cache（切換案件時呼叫）

### Constraints

- `briefs: Brief[]` 維持不變（case-level metadata 列表）
- `lawRefs`, `exhibits` 等 case-level 資料維持不變
- 使用 `Record<string, PerBriefState>` 而非 `Map`（Zustand shallow equality 友好）
- 現有外部 API（`setBriefs`, `setLawRefs`, `setExhibits` 等）簽名不變

### Acceptance Criteria

- 開 Brief A tab → cache 有 A → 開 Brief B tab → cache 有 A+B → 切回 A → 不觸發 API call
- Brief A dirty + undo 3 次 → 切到 B → 切回 A → dirty 仍為 true、可 redo 3 次
- `deleteBrief(id)` 同時從 `briefs[]` 和 `briefCache` 移除
