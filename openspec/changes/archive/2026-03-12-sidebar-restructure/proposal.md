## Why

律師撰寫書狀時，需要同時參考爭點、證據、法條和金額，但目前右側 sidebar 以「資料類型」分組（卷宗檔案 vs 分析），導致寫作時高頻需要的資訊被分散在不同 tab + sub-tab，需要多次切換。「分析」tab 下還有 3 個 sub-tab（爭點/金額/時間軸），爭點這個最核心的參考資訊需要 2 次點擊才能到達。

## What Changes

- **爭點升級為頂層 tab**：從「分析 > 爭點」sub-tab 升為與「卷宗」同級的頂層 tab
- **消滅「分析」tab 及其 sub-tab 系統**：不再有 disputes/damages/timeline 三個 sub-tab
- **金額嵌入爭點卡片**（混合模式）：
  - 摺疊狀態：爭點 header 直接顯示該爭點的金額總計
  - 展開狀態：在論證區塊下方顯示金額明細（inline 列表），支援新增/編輯/刪除
- **未關聯爭點的金額**：獨立摺疊區塊放在爭點列表底部
- **時間軸降級**：移至爭點 tab 底部的摺疊區塊（低頻使用）
- **請求總額 sticky bar**：爭點 tab 底部顯示所有金額的合計
- **前端 Damage interface 補上 dispute_id**：從 DB 已有的關聯欄位拉到前端
- **頂層 tab 順序調整**：[案件資訊] [爭點] [卷宗]

## Capabilities

### New Capabilities
- `dispute-damages-embed`: 金額嵌入爭點卡片的混合呈現模式（header 金額 + 展開明細 + CRUD）

### Modified Capabilities

（無既有 spec 需要修改）

## Impact

- **前端組件**：`RightSidebar.tsx`（tab 結構）、`DisputesTab.tsx`（爭點卡片嵌入金額）、`DamagesTab.tsx`（可能拆分或移除獨立 view）
- **前端 Store**：`useUIStore`（移除 `analysisSubTab` 狀態）、`useAnalysisStore`（Damage type 補 `dispute_id`）
- **API**：damages API response 需要包含 `dispute_id` 欄位
- **無 breaking change**：純前端 UI 重組，不影響後端邏輯或資料結構
