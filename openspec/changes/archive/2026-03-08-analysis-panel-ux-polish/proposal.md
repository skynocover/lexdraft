## Why

分析面板（爭點/金額/時間軸）有三個低成本但影響可用性的 UX 問題：收合的爭點卡片因標題截斷而無法區分、summary bar 顯示零值造成視覺噪音、展開/收合指示器風格不一致。

## What Changes

- **爭點卡片加上編號前綴**：在 DisputeCard 標題前顯示「爭點 N」，使收合狀態下可區分不同爭點
- **Summary bar 零值隱藏**：「不足 0」和「缺漏 0」在數值為 0 時不顯示，減少視覺噪音
- **統一展開/收合 icon**：將 DisputeCard 和 DamageCard 的 `▾`/`▸` 文字字元替換為 `ChevronRight` icon + rotate transition，與 RightSidebar 的 CollapsibleSection 風格一致

## Capabilities

### New Capabilities

### Modified Capabilities

## Impact

- `src/client/components/analysis/DisputesTab.tsx` — DisputeCard 標題加編號、summary bar 條件渲染、expand icon 替換
- `src/client/components/analysis/DamageCard.tsx` — expand icon 替換
