## Context

`useBriefStore` 以 `currentBrief: Brief | null` 管理唯一的活躍書狀。切換 brief tab 時 `syncActiveTabStore()` 呼叫 `loadBrief(briefId)` 覆蓋 singleton，觸發 API call 且遺失 undo/redo。SSE `brief_update` 只在 `brief_id === currentBrief.id` 時套用，pipeline 寫入非 active brief 的事件被丟棄。

現有 tab 系統（`useTabStore`）已完整支援 multi-panel split view（`splitPanel`, `moveTab`, `closePanel`），brief tab 可以拖到另一個 panel。但 `useBriefStore` singleton 導致 split view 下兩個 panel 無法各自顯示不同書狀。

## Goals / Non-Goals

**Goals:**
- 多份書狀同時在記憶體中保持完整狀態（快速切換免 API call）
- Per-brief undo/redo 歷史（切走再切回不遺失）
- Per-brief dirty/saving 狀態追蹤
- SSE 路由可更新任何已載入的 brief（pipeline 背景寫入）
- Split view：兩個 panel 各自顯示不同書狀
- Chat context 包含所有已存在書狀 metadata

**Non-Goals:**
- 不改後端 API
- 不做書狀 diff/比對功能（P3-3）
- 不做同時編輯兩份書狀的 collaborative editing
- 不做 brief 快取失效/過期策略（記憶體足夠）

## Decisions

### D1：briefCache Map 取代 currentBrief singleton

```typescript
interface PerBriefState {
  brief: Brief;
  dirty: boolean;
  saving: boolean;
  _history: ContentSnapshot[];
  _future: ContentSnapshot[];
}

// useBriefStore 新結構
interface BriefState {
  activeBriefId: string | null;         // focused panel 正在看的 brief
  briefs: Brief[];                       // case-level metadata list（不變）
  briefCache: Record<string, PerBriefState>;  // 已載入的 briefs

  // case-level（不變）
  lawRefs: LawRef[];
  exhibits: Exhibit[];
  // ...
}
```

**為什麼用 `Record<string, PerBriefState>` 而非 `Map`**：Zustand 的 shallow equality 對 plain object 更友好，且 `immer` middleware 不支援 Map。

**currentBrief 變成 derived**：所有讀取 `currentBrief` 的地方改為 `briefCache[activeBriefId]?.brief`。提供 helper selector `getActiveBrief()` 減少重複。

### D2：Tab 切換流程

```
openBriefTab(briefId)
  │
  ├── briefCache[briefId] 存在？
  │     Yes → set({ activeBriefId: briefId })      // 0 API calls
  │     No  → await api.get(`/briefs/${briefId}`)
  │           → 存入 briefCache
  │           → set({ activeBriefId: briefId })
  │
  └── 切離前的 brief dirty？
        Yes → saveBrief(prevBriefId)                // 切走時自動存
        No  → skip
```

`syncActiveTabStore` 不再呼叫 `loadBrief()`，改為直接 set `activeBriefId`。如果 cache miss 才觸發 API。

### D3：SSE brief_update 路由

```typescript
// 改前
case 'add_paragraph': {
  if (!event.brief_id || briefStore.currentBrief?.id === event.brief_id) {
    briefStore.addParagraph(p);
  }
}

// 改後
case 'add_paragraph': {
  const targetId = event.brief_id;
  if (targetId && briefStore.briefCache[targetId]) {
    briefStore.addParagraphTo(targetId, p);  // 新方法：指定 briefId
  }
}
```

`create_brief` 事件：建立新 brief 後自動加入 `briefCache`，開 tab 並設為 active。

### D4：A4PageEditor 改讀 briefCache

```typescript
// 改前
const currentBrief = useBriefStore((s) => s.currentBrief);

// 改後：接收 briefId prop（來自 tab 的 briefId）
export function A4PageEditor({ briefId }: { briefId: string }) {
  const briefState = useBriefStore((s) => s.briefCache[briefId]);
  const brief = briefState?.brief;
  const dirty = briefState?.dirty ?? false;
  const saving = briefState?.saving ?? false;
  // ...
}
```

**briefId 從哪來**：`EditorPanel` 渲染 active tab 時，如果 tab type 是 `brief`，把 `tabData.briefId` 傳給 `A4PageEditor`。

### D5：useAutoSave 改為 per-brief

兩個觸發時機：

1. **切 tab 離開 dirty brief → 立即存**
   - `syncActiveTabStore` 中，切離前檢查 prev brief dirty → `saveBrief(prevBriefId)`

2. **定期掃描（保持現有 debounce）**
   - `useAutoSave` 監聽 `briefCache` 中 active brief 的 `dirty`
   - dirty 後 2 秒存（行為不變，只是資料來源改為 cache）

### D6：Chat context 加入 allBriefs

```typescript
// useChatStore.ts sendMessage()
const activeBrief = briefStore.getActiveBrief();
const requestBody: ChatRequest = { message };

if (activeBrief) {
  requestBody.briefContext = {
    brief_id: activeBrief.id,
    title: activeBrief.title || DEFAULT_BRIEF_LABEL,
    paragraphs: /* ... */,
  };
}

// 新增：所有已存在書狀的 metadata
requestBody.allBriefs = briefStore.briefs.map((b) => ({
  id: b.id,
  title: b.title,
  template_id: b.template_id,
}));
```

AgentDO system prompt 新增一段：「案件已有的書狀：起訴狀 (id: xxx)、答辯狀 (id: yyy)」。

### D7：Split view — 最小改動

`useTabStore` 的 split panel 機制已完整。唯一需要的改動：

1. `A4PageEditor` 接收 `briefId` prop（D4 已處理）
2. `focusPanel` 時更新 `activeBriefId`（`syncActiveTabStore` 已處理）
3. Chat context 送 focused panel 的 brief

**不需要 per-panel activeBriefId** — 每個 panel 的 `activeTabId` 已指向正確的 brief tab，`A4PageEditor` 直接從 tab 的 `briefId` 讀 cache。`activeBriefId` 只用於 chat context 和 toolbar 狀態。

### D8：BriefsSection dirty 指示

Sidebar 的書狀列表項目顯示 dirty 標記（小圓點），讓用戶知道哪些書狀有未存的變更。

```typescript
// BriefsSection.tsx
const briefCache = useBriefStore((s) => s.briefCache);
// 渲染時
{briefCache[brief.id]?.dirty && <span className="w-1.5 h-1.5 rounded-full bg-ac" />}
```

### D9：clearTabs 時清理 briefCache

`useTabStore.clearTabs()`（切換案件時觸發）需要一併清空 `briefCache`，避免舊案件的 brief 殘留。

## Risks / Trade-offs

**[R1] Store 重構可能引入 regression** → 逐步改：先改 store 結構 + selector，再改 SSE handler，最後改 UI 組件。每步確認 type check 通過。

**[R2] briefCache 記憶體佔用** → 一份書狀 ~50-100 段落，每段 ~1KB，最多 3-5 份 = ~500KB。不是問題。

**[R3] A4PageEditor 的 Tiptap 編輯器重新初始化** → 切 tab 時 editor 會 unmount/remount（現有行為），但 content 從 cache 讀取，初始化速度不受影響。

**[R4] saveBrief 競爭條件** → 切 tab 觸發自動存 + autoSave debounce 可能同時存。用 `saving` flag 防止重複（現有機制已有）。
