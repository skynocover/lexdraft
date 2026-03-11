## Why

爭點卡片展開後，律師最在意的資訊（我方立場、對方立場）完全沒有顯示，反而事實爭議（FactList）佔滿版面。每個 fact 卡片還重複列出相同的檔案名稱，導致資訊層級倒反、畫面雜亂。

此外，經過資料生命週期分析後發現：
- **Claims（攻防主張）是書狀級產物**（pipeline Step 2 推導），不屬於案件級的爭點分析，不該顯示在 disputes tab
- **Facts（事實爭議）是案件級的穩定資料**（Issue Analyzer 提取），屬於爭點脈絡，但目前沒有持久化到 DB，頁面重載後遺失

## What Changes

- 展開區新增「我方立場 / 對方立場」區塊，作為最顯眼的內容
- Claims（攻防主張）從 disputes tab 完全移除 — 它是 pipeline 產物，不屬於爭點分析
- 事實爭議改為預設收合的子區塊（`▸ 事實爭議 (N)`），保留在爭點脈絡內
- FactList 簡化：移除 per-fact 的檔案引用，只保留 badge + 描述文字
- 後端：`disputes` 表新增 `facts` 欄位，持久化 facts 資料
- 後端：`persistDisputes` 不再刪除 claims（claims 是 pipeline 的產物）

## Capabilities

### New Capabilities
- `dispute-card-layout`: 爭點卡片展開區的資訊層級重新設計

### Modified Capabilities
（無）

## Impact

- **`src/client/components/analysis/DisputesTab.tsx`**：展開區重寫 + 移除 claims 相關元件
- **`src/client/components/analysis/FactList.tsx`**：簡化為 badge + 描述，移除 per-fact 檔案引用
- **`src/server/services/analysisService.ts`**：persistDisputes 存 facts、不刪 claims
- **`src/server/routes/briefs.ts`**：GET /disputes 回傳 parsed facts
- **DB migration**：disputes 表加 `facts TEXT`
