## Context

DisputesTab 是右側面板「分析」tab 下的子頁面，顯示爭點分析結果。目前三個區塊（資訊缺口、不爭執事項、爭點卡片）各自使用不同的展開/關閉機制，且佈局順序導致主要內容（爭點）被次要資訊擠到可見範圍外。

現有元件：
- `InformationGapsBlock`：非摺疊，dismiss (X) 按鈕，bullet list
- `UndisputedFactsBlock`：shadcn Collapsible，checkmark list
- `DisputeCard`：個別卡片展開，不需變更

## Goals / Non-Goals

**Goals:**
- 爭點卡片在 tab 打開時立刻可見（不需捲動）
- 資訊缺口和不爭執事項使用統一的 Section Collapsible 模式
- 以截斷 card + tooltip 取代條列式，提升掃描效率

**Non-Goals:**
- 不改 DisputeCard 本身的 UI
- 不改資料結構或 store
- 不加個別 card 展開（方案 B），先用 tooltip（方案 A）
- 不加 card 的操作按鈕（標記已處理等），留給未來

## Decisions

### D1: 統一 Section Collapsible 模式

資訊缺口和不爭執事項使用相同的 Collapsible 結構：

```
┌───────────────────────────────────┐
│ {icon}  {title}  ({count})    ▸   │  ← CollapsibleTrigger
├───────────────────────────────────┤  ← 展開時顯示
│ ┌───────────────────────────────┐ │
│ │ card 1（截斷文字）            │ │
│ └───────────────────────────────┘ │
│ ┌───────────────────────────────┐ │
│ │ card 2（截斷文字）            │ │
│ └───────────────────────────────┘ │
└───────────────────────────────────┘
```

**Rationale**: 移除 dismiss (X) 改用 collapsible，律師可反覆開合查看，不會「弄丟」提醒。兩個區塊用同一套視覺語言降低認知負擔。

### D2: Card + 單行截斷 + Tooltip

每個 gap/fact 作為獨立的小 card：
- 使用 `line-clamp-1` 截斷文字到單行
- Hover 時用 shadcn `Tooltip` 顯示全文
- Card 樣式：`rounded bg-bg-1 px-2.5 py-1.5`（輕量，不搶爭點卡片的視覺重量）

**Rationale**: Card 給每個項目視覺分隔，截斷大幅減少空間佔用。Tooltip 比個別展開更輕量（不增加 UI 層級）。

**Alternative considered**: 方案 B（可展開 card）——三層互動（section collapsible → card list → card expand）太深，先不做。

### D3: 佈局順序

```
資訊缺口 (Collapsible, 預設收合)
    ↓
爭點卡片（主要內容，立刻可見）
    ↓
不爭執事項 (Collapsible, 預設收合)
```

**Rationale**: 資訊缺口在最上方作為提醒，但收合後只佔一行。爭點卡片是主要操作對象，放中間。不爭執事項是已確認的背景資訊，放最下。

### D4: 資訊缺口 icon 保持橘色語意

資訊缺口 section header 使用 `AlertTriangle` icon + 橘色 `text-or`，card 左側保留橘色指示條。不爭執事項 header 使用 `Check` icon + 綠色 `text-gr`，card 左側保留綠色指示條。

**Rationale**: 顏色語意延續現有設計（橘色=注意、綠色=已確認），律師直覺理解。

## Risks / Trade-offs

- **Tooltip 在行動裝置無法 hover** → 目前產品主要在桌面使用，可接受。未來如需行動支援再加 click-to-expand
- **單行截斷可能截太多資訊** → 律師能透過 tooltip 查看全文，且 section 展開後所有 card 都可見
- **移除 dismiss (X)** → Collapsible 收合比 dismiss 更好（可重新展開），不是功能降級
