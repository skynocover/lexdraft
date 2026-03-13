## Context

爭點 Tab（`DisputesTab`）目前渲染三種卡片：

1. **DisputeCard** — `rounded border border-bd bg-bg-2`，結構化 header（爭點 N + pill badge + edit/delete）+ 展開內容
2. **FactCard**（在 UndisputedFactsBlock 內）— `rounded bg-bg-1 px-2.5 py-1.5`，純文字 line-clamp-2
3. **InlineDamageItem**（同在 UndisputedFactsBlock 內）— `rounded bg-bg-1 px-2 py-1.5`，左文右金額 + 展開描述

三者視覺差異大，且 FactCard 與 InlineDamageItem 混在同一個 collapsible 裡，不符法院實務「不爭執事項」與「損害金額」分開整理的慣例。

資料層面已完全分開（`cases.undisputed_facts` vs `damages` 表 `dispute_id=null`），不需改後端。

## Goals / Non-Goals

**Goals:**
- 將不爭執事項和不爭執金額拆為兩個獨立 collapsible 區塊
- 統一三種卡片的視覺基底（方向 C：同一卡片殼 + icon 區分類型）
- FactCard 加 checkmark icon，InlineDamageItem 在不爭執金額區保持 $ / 金額呈現
- 不爭執金額區獨立顯示 subtotal 和 add 按鈕

**Non-Goals:**
- 不改後端、資料庫、prompt
- 不改 DisputeCard 的展開內容結構（我方/對方論證 + 請求金額）
- 不改 InlineDamageItem 在 DisputeCard 內的用法（那裡保持原樣）
- 不重新設計爭點卡片本身的 header 結構

## Decisions

### D1：拆分方式 — 新建 `UndisputedDamagesBlock` 元件

**選擇**：新建獨立元件 `UndisputedDamagesBlock.tsx`，與 `UndisputedFactsBlock` 平行渲染
**替代方案**：在同一元件內用視覺分隔 — 但兩個區塊的 header 互動不同（facts 有 add text、damages 有 add dialog），拆開更乾淨
**理由**：各自管理 collapsible 狀態、CRUD、count，互不干擾

### D2：卡片視覺統一策略

所有子項目卡片共用基底：`rounded bg-bg-1 px-2.5 py-1.5`

差異透過 icon 標記：
- FactCard：左側 `Check` icon (text-gr, size-3)，標識「已確認事實」
- InlineDamageItem（不爭執金額區）：無額外 icon，金額右對齊已足夠區分

FactCard 的 icon 在卡片內部，不是 indent 到左邊，這樣卡片寬度跟 InlineDamageItem 對齊。

### D3：UndisputedFactsBlock 簡化

移除所有金額相關 props（`undisputedDamages`、`undisputedDamageTotal`、`onEditDamage`、`onDeleteDamage`），純化為只處理文字事實。Header 不再顯示金額 subtotal。

### D4：UndisputedDamagesBlock header 設計

```
$ 不爭執金額 (3)        NT$ 67,700  +
```

- Icon：`DollarSign`（lucide-react），`size-3.5 text-ac`
- Label：`不爭執金額`
- Count：`({count})`
- Subtotal：右對齊 `text-xs text-t3`
- Add 按鈕：呼叫 `onAddDamage(null)`（dispute_id = null）

### D5：DisputesTab 渲染順序

```
1. Header（N 個爭點 + reanalyze）
2. InformationGapsBlock
3. DisputeCard × N
4. UndisputedFactsBlock（純文字事實）
5. UndisputedDamagesBlock（不爭執金額）
6. Sticky footer（請求總額）
```

不爭執金額放在最下面（文字事實之後），因為律師通常先掃爭點和事實、再看金額明細。

## Risks / Trade-offs

- **[項目少時稍顯空]** → 兩個區塊各有 0 項時各自 `return null`，不會佔空間
- **[多一層認知結構]** → 法院實務本就分開，律師心智模型一致，不算額外負擔
- **[UndisputedDamagesBlock 與 DisputeCard 內的 InlineDamageItem 共用元件]** → InlineDamageItem 不改，兩處都能用。不爭執金額區傳 `showRefs` 顯示來源文件
