## Context

分析面板右側欄（RightSidebar → AnalysisSidebarContent）包含三個 sub-tab：爭點、金額、時間軸。目前有三個 UX 問題需修復，全部都在前端元件層，不涉及 API 或資料結構變更。

相關檔案：
- `DisputesTab.tsx` — DisputeCard 元件、summary bar
- `DamageCard.tsx` — 金額展開/收合
- `RightSidebar.tsx` — CollapsibleSection 使用 ChevronRight icon 作為參考風格

## Goals / Non-Goals

**Goals:**
- 收合的爭點卡片可透過編號前綴區分
- Summary bar 在零值時不顯示該狀態項，減少噪音
- 展開/收合指示器統一使用 ChevronRight icon + rotate-90 transition

**Non-Goals:**
- 不修改爭點資料模型或 API
- 不重構攻防鏈排序邏輯
- 不做時間軸年份分群（另案處理）
- 不修改 hover-only 按鈕的可及性問題（另案處理）

## Decisions

### 1. 爭點編號來源：index+1 而非 dispute.number

DB 的 `disputes.number` 欄位由 AI 產生，可能不連續或有跳號。使用陣列 index+1 更直觀且保證連續。

格式：`爭點 {index+1}：{title}`，在 DisputeCard button 內的 title span 前加上。

### 2. Chevron icon 統一方案

參考 `RightSidebar.tsx` CollapsibleSection 的做法：
```tsx
<ChevronRight
  size={14}
  className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
/>
```

替換 DisputeCard 和 DamageCard 中的 `▾`/`▸` 文字。

### 3. Summary bar 條件渲染

將三個計數項改為條件渲染：
```tsx
{summary.ok > 0 && <span className="text-gr">充分 {summary.ok}</span>}
{summary.warn > 0 && <span className="text-yl">不足 {summary.warn}</span>}
{summary.miss > 0 && <span className="text-rd">缺漏 {summary.miss}</span>}
```

## Risks / Trade-offs

- 爭點編號使用 index+1 意味著刪除爭點後編號會重排，不過這符合使用者預期（連續編號）
- Chevron icon 需要 import `ChevronRight` from lucide-react，兩個檔案各加一個 import
