## 1. 新建 UndisputedDamagesBlock 元件

- [x] 1.1 建立 `src/client/components/analysis/UndisputedDamagesBlock.tsx`：collapsible 容器、DollarSign icon header、count + subtotal 顯示、add 按鈕
- [x] 1.2 內部渲染 `InlineDamageItem` 列表（傳 `showRefs={true}`），接收 `onEditDamage`、`onDeleteDamage`、`onAddDamage` props

## 2. 簡化 UndisputedFactsBlock

- [x] 2.1 移除 `UndisputedFactsBlock` 的金額相關 props（`undisputedDamages`、`undisputedDamageTotal`、`onEditDamage`、`onDeleteDamage`）和 InlineDamageItem 渲染邏輯
- [x] 2.2 Header count 改為只計算 `facts.length`，移除金額 subtotal 顯示

## 3. FactCard 加 checkmark icon

- [x] 3.1 在 FactCard 文字左側加 `Check` icon（`size-3 text-gr`），調整 layout 為 flex + gap

## 4. 整合到 DisputesTab

- [x] 4.1 在 `DisputesTab` 中 `UndisputedFactsBlock` 下方新增 `UndisputedDamagesBlock`，傳入 `unassignedDamages`、`unassignedTotal`、`onAddDamage`、`onEditDamage`、`onDeleteDamage`
- [x] 4.2 從 `UndisputedFactsBlock` 呼叫處移除金額相關 props

## 5. 驗證與格式化

- [ ] 5.1 手動驗證：爭點 tab 三區塊正確渲染、collapsible 獨立運作、CRUD 正常
- [x] 5.2 執行 prettier 格式化修改的檔案
- [x] 5.3 執行 `npx tsc --noEmit` 確認無型別錯誤（pre-existing Zod schema errors only，無新增錯誤）
