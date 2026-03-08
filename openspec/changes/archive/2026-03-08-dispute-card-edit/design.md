## Context

爭點（disputes）目前只有 AI 全量寫入的流程（`analyzeDisputes.ts` 中 delete all → insert），沒有單筆 CRUD API。Claims 透過 `dispute_id` FK 關聯爭點。書狀段落的 `dispute_id` 是弱引用（用於跳轉），刪除爭點不需處理。

現有 patterns 可參考：
- `DamagesTab` + `useAnalysisStore` 的 `addDamage`/`updateDamage`/`removeDamage` — 相同的 store action + API 模式
- `DamageCard` 的 hover 顯示編輯/刪除按鈕 — 相同的 UI pattern

## Goals / Non-Goals

**Goals:**
- 律師可直接在 DisputeCard 上改標題和刪除爭點
- 刪除爭點時 cascade delete 關聯 claims
- UI pattern 與 DamageCard/TimelineCard 一致（hover 顯示按鈕）

**Non-Goals:**
- 不做新增爭點（留給 chatbot tool）
- 不做 claims 層級的 CRUD
- 不做爭點合併/拆分
- 刪除爭點不連動書狀段落

## Decisions

### 1. API 設計：跟隨 damages 現有 pattern

參考 damages 的 API pattern（`cases.ts` 中的 PATCH/DELETE damages endpoints）：

```
PATCH /api/cases/:caseId/disputes/:id
  body: { title: string }
  → update disputes set title where id AND case_id

DELETE /api/cases/:caseId/disputes/:id
  → delete claims where dispute_id = id
  → delete disputes where id AND case_id
```

刪除順序：先刪 claims（FK 約束），再刪 dispute。

### 2. Inline edit 方式：controlled input + Enter/Escape

點擊編輯按鈕 → 標題文字變成 input → Enter 儲存 / Escape 取消。不用 dialog，因為只有一個欄位。

### 3. Hover 按鈕與 DamageCard/TimelineCard 一致

在 DisputeCard header 的第一行（爭點 N 那行）hover 時顯示 Pencil + Trash2 按鈕，與 DamageCard 用同樣的 pattern。

## Risks / Trade-offs

- `damages.dispute_id` 也有 FK reference 到 disputes，但刪除爭點不處理 damages（damages 是獨立的金額項目，dispute_id 只是可選關聯）。D1 SQLite 預設不 enforce FK，所以不會 error，只是 damages 上的 dispute_id 會變成 dangling reference。這可接受。
