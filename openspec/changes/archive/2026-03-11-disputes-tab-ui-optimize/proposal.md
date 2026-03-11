## Why

DisputesTab 目前的資訊層級倒置——律師進入「爭點」tab 後，資訊缺口（佔 ~40% viewport）和不爭執事項（展開後佔 ~60%）把實際爭點卡片推到需要捲動才能看到的位置。此外，三個區塊各自使用不同的摺疊/關閉機制，視覺不一致。條列式的 bullet list 文字密度過高，不利於快速掃描。

## What Changes

- **資訊缺口改為 Collapsible**：移除現有的 dismiss (X) 機制，改用與不爭執事項相同的 Collapsible 模式，預設收合
- **佈局重排序**：從「資訊缺口 → 不爭執事項 → 爭點」改為「資訊缺口 → 爭點 → 不爭執事項」
- **統一 Section Collapsible UI**：資訊缺口和不爭執事項使用完全相同的 Collapsible 視覺模式（icon + 標題 + 數量 + chevron）
- **Card 呈現取代條列式**：資訊缺口的 bullet list 和不爭執事項的 checkmark list 改為獨立 card，單行截斷 + hover tooltip 顯示全文

## Capabilities

### New Capabilities
- `section-collapsible-cards`: 統一的 Section Collapsible + 截斷 Card 呈現模式，用於資訊缺口和不爭執事項

### Modified Capabilities

（無既有 spec 需要修改）

## Impact

- `src/client/components/analysis/DisputesTab.tsx` — InformationGapsBlock、UndisputedFactsBlock 重寫，DisputesTab 佈局順序調整
- `src/client/components/analysis/FactList.tsx` — UndisputedFactList 改為 card 樣式
- 爭點卡片 (DisputeCard) 不變
- Store / 後端不變
