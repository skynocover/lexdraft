## 1. Store 層修改

- [x] 1.1 `useUIStore.ts`：`SidebarTab` type 新增 `'timeline'` 值（`'case-info' | 'disputes' | 'case-materials' | 'timeline'`）

## 2. DisputesTab 移除時間軸

- [x] 2.1 `DisputesTab.tsx`：移除時間軸 `Collapsible` 區塊（L148-166）和 `timelineCount` 訂閱、`Clock` import

## 3. RightSidebar tab bar 重構

- [x] 3.1 `RightSidebar.tsx`：`SIDEBAR_TABS` 陣列改為三個核心 tab（爭點、卷宗、時序），移除 `case-info`，新增 `timeline`（icon: `Clock`）
- [x] 3.2 `RightSidebar.tsx`：tab bar 右側新增案件資訊 icon 按鈕（`Info` icon），點擊呼叫 `setSidebarTab('case-info')`，active 時 `text-ac` 高亮，位置在 `flex-1` spacer 之後、收合按鈕之前
- [x] 3.3 `RightSidebar.tsx`：content area 新增 `sidebarTab === 'timeline'` 的渲染分支，使用 `TooltipProvider` + padding 容器包裹 `TimelineTab`，加 header row（事件數量 + ReanalyzeButton）

## 4. 時間軸空狀態

- [x] 4.1 時序 tab 空狀態 UI：當 `timeline.length === 0` 時顯示 Clock icon + 提示文字 + `EmptyAnalyzeButton type="timeline"`

## 5. 驗證與格式化

- [x] 5.1 `npx tsc --noEmit` 通過（無新增錯誤，13 個既有 Zod schema 錯誤不受影響）
- [x] 5.2 `npx prettier --write` 格式化修改的檔案
