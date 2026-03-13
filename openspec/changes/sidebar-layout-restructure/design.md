## Context

右側 sidebar 目前有 3 個頂層 tab（案件資訊、爭點、卷宗），時間軸嵌在爭點 tab 最底部的 `Collapsible` 裡。Tab bar 寬度 352px，使用 icon + 文字標籤。

相關檔案：
- `src/client/components/layout/RightSidebar.tsx` — tab bar + 內容路由
- `src/client/components/analysis/DisputesTab.tsx` — 爭點 tab，含時間軸 Collapsible（L148-166）
- `src/client/components/analysis/TimelineTab.tsx` — 時間軸內容元件
- `src/client/stores/useUIStore.ts` — `SidebarTab` type + tab state

## Goals / Non-Goals

**Goals:**
- 時間軸成為獨立頂層 tab，與爭點、卷宗平行
- 案件資訊降級為 tab bar 右側小 icon，減少對核心分析 tab 的視覺干擾
- 保持所有現有功能不變，僅改變導航結構

**Non-Goals:**
- 不改變 TimelineTab 元件內部的 UI 或功能
- 不改變案件資訊表單的內容或欄位
- 不新增任何 API endpoint
- 不改變 store 的資料結構（只改 `SidebarTab` type）

## Decisions

### D1: Tab bar 排列方式

三個核心 tab 左對齊排列，案件資訊 icon 靠右與收合按鈕相鄰：

```
┌─────────────────────────────────────────────┐
│ ⚔️爭點  📁卷宗  🕐時序     [ℹ️] [»]       │
│  active               ↑flex-1↑  info  close │
└─────────────────────────────────────────────┘
```

**理由**：爭點、卷宗、時序是高頻操作的分析面板，平等排列。案件資訊是低頻設定，退居角落但仍一鍵可達。

**替代方案**：
- 方案 B（popover）：案件資訊改用 popover/sheet 彈出 → 放棄，因為表單欄位多（法院、當事人、AI 設定），popover 空間不夠優雅
- 方案 C（4 tab 平等）：保持 4 個平等 tab → 放棄，案件資訊不應與分析 tab 平等佔位

### D2: 案件資訊 icon 的視覺處理

使用 `Info` icon（lucide-react），樣式與收合按鈕（`ChevronsRight`）一致（`p-1 text-t3 hover:bg-bg-h hover:text-t1`），active 時加 `text-ac` 高亮。不加文字標籤。

**理由**：與收合按鈕同一視覺群組，表達「這是工具按鈕，不是內容 tab」。

### D3: 時間軸 tab 的內容結構

直接複用 `<TimelineTab />` 元件，外層加 `TooltipProvider` + 標準 padding 容器（與爭點 tab 容器一致），並在頂部加一個 header row 顯示事件數量和 reanalyze 按鈕。

**理由**：TimelineTab 已是獨立元件，直接提升即可。加 header row 是因為從 Collapsible 搬出後，原本 trigger 上的事件數量 badge 消失了，需要在 tab 內補上。

### D4: 預設 tab 不變

`useUIStore` 預設 `sidebarTab: 'case-materials'` 不改。新用戶首次進入看到卷宗 tab 是合理的（上傳檔案是第一步）。

## Risks / Trade-offs

- **Tab bar 寬度壓力**：352px 放 3 個 icon+text tab + 2 個 icon button 可能略擠 → 實作時觀察，必要時可縮短標籤（如「卷宗」→「卷宗」已經很短，問題不大）
- **時間軸空 tab 狀態**：尚未生成時間軸時，時序 tab 需要空狀態 UI（類似爭點的 EmptyAnalyzeButton）→ 在 TimelineTab 中已有空狀態處理，確認後直接複用
