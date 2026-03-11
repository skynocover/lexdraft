## Context

DisputeCard 展開後原本的渲染順序：claims → FactList → 證據/法條 tags → 跳到段落。問題是 `our_position`/`their_position` 完全沒有渲染，FactList 每個 fact 帶完整檔案名重複佔版面。

經資料生命週期分析後，進一步發現 claims 是書狀級產物（pipeline Step 2），不該出現在案件級的 disputes tab。Facts 是案件級穩定資料但沒有持久化。

Sidebar 寬度 `w-88`（352px），空間有限。

## Goals / Non-Goals

**Goals:**
- 展開後第一眼就能看到雙方立場
- 事實爭議作為可收合的細節區，保留在爭點脈絡內
- Claims 從 disputes tab 完全移除
- FactList 簡化，不重複顯示檔案
- Facts 持久化到 DB，頁面重載不遺失

**Non-Goals:**
- 不改 DisputesTab 列表層級（爭點數量、header、empty state 等）
- 不改 claims 在 pipeline 中的行為（仍正常產出、persist、SSE）
- 不新增 analysis sub-tab（facts 留在爭點內，不獨立 tab）

## Decisions

### 1. 展開區元件結構

```
DisputeCard expanded content
├── PositionBlock             ← 我方/對方立場
│   ├── 我方 (border-l-ac)
│   └── 對方 (border-l-or)
├── TagRow                    ← 證據+法條 tags
│   ├── evidence tags (bg-bg-3)
│   └── law_ref tags (bg-cy/10)
└── FactsCollapsible          ← 事實爭議，預設收合
    └── CompactFactItem × N
```

注意：**不包含 ClaimsCollapsible**。Claims 是 pipeline Step 2 的產物（`assigned_section` 綁書狀段落），不屬於案件級的爭點分析。

### 2. PositionBlock 設計

- 用 `border-l-2 border-l-ac` / `border-l-or` 左色條區分我方/對方
- 標題用 `text-xs font-medium text-t3`，內容用 `text-sm text-t1`
- 內容超過 3 行時 `line-clamp-3`，完整內容顯示在 `title` 屬性（原生 tooltip）
- 如果 `our_position` 和 `their_position` 都為空則不渲染整個 block

### 3. 收合邏輯

使用 shadcn `Collapsible` 元件：
- 「▸ 事實爭議 (4)」— 有 facts 才顯示，預設收合
- Chevron 旋轉 90° 表示展開

### 4. FactList 簡化

移除每個 fact 的 `evidence` 檔案 tags 和 `source_side` 顯示。只保留：
- assertion_type badge（承認/爭執/推定/自認/主張）
- description 文字
- disputed_by 爭議提示（有才顯示）

### 5. 移除「跳到段落」

前次 explore 確認此功能價值不大。移除以減少雜訊。

### 6. Claims 從 DisputesTab 移除

移除的元件和邏輯：
- `ClaimCard` 元件、`sortClaimsByThread` 排序函式
- `CLAIM_TYPE_LABEL`、`SIDE_STYLE` 常數
- `claimsByDispute` memo、`unclassifiedClaims` 區塊
- Header 的「我方 X / 對方 Y」claims 計數

Claims 在 pipeline 中仍正常運作（persist + SSE + toast），只是不在 disputes tab 顯示。

### 7. Facts 持久化

- DB migration：`disputes` 表加 `facts TEXT`（JSON string，同 `evidence`/`law_refs` 模式）
- `persistDisputes()`：寫入 `JSON.stringify(issue.facts)`
- `persistDisputes()`：移除 `delete claims`（claims 是 pipeline 產物，重新分析爭點不該動）
- GET `/cases/:caseId/disputes`：回傳 `facts: d.facts ? JSON.parse(d.facts) : []`
- 舊資料 `facts` 為 `null` → 前端 guard `dispute.facts?.length > 0` 已處理

## Risks / Trade-offs

- **[資訊被隱藏]** 事實爭議預設收合 → 律師需要多一次點擊 → 但大部分情境看 positions 就夠了
- **[line-clamp]** 立場文字截斷可能影響閱讀 → 用原生 title tooltip 補償
- **[claims 消失]** Claims 從 disputes tab 移除 → pipeline 完成時 chatbot 仍會顯示摘要（已有），律師不會完全看不到
