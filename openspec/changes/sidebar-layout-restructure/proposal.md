## Why

右側 sidebar 的資訊架構不符合律師工作流程。時間軸被塞在爭點 tab 最下面的摺疊區裡，語意上不屬於爭點分析，且當爭點多時幾乎不可見。案件資訊是低頻設定操作，卻與高頻分析 tab 平等佔位，稀釋了核心工作面板的視覺重心。

## What Changes

- **時間軸升級為頂層 tab**：從 `DisputesTab` 內的 `Collapsible` 搬出，成為獨立的「時序」tab，與爭點、卷宗平行
- **案件資訊降級為 icon 入口**：從文字 tab 改為 tab bar 右側的小 icon（`Info`），點擊仍切換到完整的案件設定面板
- **Tab bar 視覺調整**：三個核心分析 tab（爭點、卷宗、時序）用 icon + 文字標籤平等排列，案件資訊 icon 靠右與收合按鈕相鄰
- **`SidebarTab` type 擴充**：新增 `'timeline'` 值
- **`DisputesTab` 瘦身**：移除時間軸相關的 `Collapsible` 區塊和 `timelineCount` 訂閱

## Capabilities

### New Capabilities
- `sidebar-tab-layout`: Tab bar 重新排列 — 三個核心 tab 平等排列 + 案件資訊降級為 icon 按鈕
- `timeline-tab`: 時間軸獨立 tab 面板 — 從爭點 tab 中抽出 TimelineTab 成為頂層 tab 內容

### Modified Capabilities

（無既有 spec 需要修改）

## Impact

- **前端元件**：`RightSidebar.tsx`（tab bar 結構）、`DisputesTab.tsx`（移除時間軸區塊）、`useUIStore.ts`（SidebarTab type）
- **無 API / DB 變更**：純前端 UI 重構
- **無破壞性變更**：所有功能保留，僅改變導航位置
