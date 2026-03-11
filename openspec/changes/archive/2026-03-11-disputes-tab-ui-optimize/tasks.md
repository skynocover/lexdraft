## 1. InformationGapsBlock 重構

- [x] 1.1 移除 dismiss (X) 機制和 `dismissed` state，改用 shadcn Collapsible（預設收合）
- [x] 1.2 統一 header 樣式：AlertTriangle icon + "資訊缺口" + (count) + ChevronRight
- [x] 1.3 內容改為 card 列表：每個 gap 一張 card，`line-clamp-1` 截斷 + Tooltip 全文

## 2. UndisputedFactsBlock + FactList 重構

- [x] 2.1 UndisputedFactsBlock header 統一樣式：Check icon + "不爭執事項" + (count) + ChevronRight（與資訊缺口一致）
- [x] 2.2 FactList 從 checkmark list 改為 card 列表：每個 fact 一張 card，`line-clamp-1` 截斷 + Tooltip 全文

## 3. DisputesTab 佈局調整

- [x] 3.1 調整 render 順序：InformationGapsBlock → disputes.map(DisputeCard) → UndisputedFactsBlock

## 4. 驗證與格式化

- [x] 4.1 執行 prettier 格式化修改的檔案
- [x] 4.2 執行 `npx tsc --noEmit` 確認無型別錯誤（pre-existing Zod v4 errors only, 無新增錯誤）
