## Why

爭點 Tab 中三種卡片（爭點、不爭執事項、不爭執金額）的視覺風格差異過大，律師掃描時視覺節奏跳動。同時，不爭執事項（純文字）和不爭執金額（結構化損害）混在同一個 collapsible 區塊，不符合法院實務中分開整理的慣例，也讓律師「核對金額」和「確認事實」兩個不同工作模式無法快速切換。

## What Changes

- 將 `UndisputedFactsBlock` 拆為兩個獨立區塊：純文字事實區 + 不爭執金額區
- 統一三種卡片的視覺基底（方向 C：統一卡片殼 + icon 標記區分類型）
- 不爭執金額區獨立顯示 subtotal
- 純文字事實卡片加上 checkmark icon，與金額卡片的 $ icon 形成一致的識別系統

## Capabilities

### New Capabilities
- `undisputed-damages-block`: 獨立的不爭執金額區塊元件，從 UndisputedFactsBlock 分離出來，有自己的 collapsible header、subtotal 顯示、和 CRUD 操作

### Modified Capabilities
<!-- 無需修改現有 spec 層級行為，資料模型和 prompt 不變 -->

## Impact

- `src/client/components/analysis/UndisputedFactsBlock.tsx` — 移除金額渲染邏輯，純化為文字事實區塊
- `src/client/components/analysis/DisputesTab.tsx` — 調整佈局，分別渲染兩個區塊
- `src/client/components/analysis/InlineDamageItem.tsx` — 可能微調卡片樣式以配合統一視覺
- `src/client/components/analysis/DisputeCard.tsx` — 可能微調卡片基底樣式
- 不涉及後端、資料庫、prompt 變更
