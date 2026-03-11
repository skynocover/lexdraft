## 1. DisputeCard 展開區重構（已完成）

- [x] 1.1 在 DisputeCard 展開區頂部新增 PositionBlock：顯示 `our_position`（border-l-ac）和 `their_position`（border-l-or），文字 `line-clamp-3` + `title` tooltip
- [x] 1.2 將現有 FactList 渲染區改為 Collapsible 收合區塊：「▸ 事實爭議 (N)」，有 facts 才顯示，預設收合
- [x] 1.3 移除「跳到段落 →」按鈕及相關 `handleJumpToParagraph` 函式
- [x] 1.4 調整展開區渲染順序：PositionBlock → TagRow → FactsCollapsible

## 2. FactList 簡化（已完成）

- [x] 2.1 移除 FactList 中每個 fact 的 evidence 檔案 tags（`fact.evidence` 區塊）
- [x] 2.2 移除 FactList 中的 `source_side` 顯示（「來源：我方/對方」）
- [x] 2.3 保留 `disputed_by` 爭議提示（橘色區塊）

## 3. Claims 從 DisputesTab 移除

- [x] 3.1 移除 `ClaimsCollapsible` 區塊（展開區內）
- [x] 3.2 移除 `ClaimCard` 元件、`sortClaimsByThread` 函式、`CLAIM_TYPE_LABEL`、`SIDE_STYLE` 常數
- [x] 3.3 移除 `claimsByDispute` memo、`unclassifiedClaims` 區塊、claims prop 傳遞
- [x] 3.4 Header 的「我方 X / 對方 Y」claims 計數改為只顯示證據/法條計數

## 4. Facts 持久化（後端）

- [x] 4.1 DB migration：`disputes` 表新增 `facts TEXT` 欄位
- [x] 4.2 `persistDisputes()` 寫入 `JSON.stringify(issue.facts)` 到 facts 欄位
- [x] 4.3 `persistDisputes()` 移除 `delete claims` — claims 是 pipeline 產物，不該被爭點分析影響
- [x] 4.4 GET `/cases/:caseId/disputes` 回傳 parsed facts：`facts: d.facts ? JSON.parse(d.facts) : []`

## 5. Bug Fix + 架構改善

- [x] 5.1 Case Reader `maxTokens` 從預設 8192 提升至 16384，修復大案件 JSON 截斷問題
- [x] 5.2 Issue Analyzer `maxTokens` 從 8192 提升至 16384，同上
- [x] 5.3 移除 `runDisputesFallback` — 失敗直接回傳錯誤給前端，不再靜默降級
- [x] 5.4 移除 `buildDisputesFallbackPrompt`、`DISPUTES_SCHEMA`（已無引用）
- [x] 5.5 錯誤訊息傳回前端：Case Reader / Issue Analyzer 失敗時回傳具體 error message

## 6. 驗證

- [x] 6.1 `npx tsc --noEmit` 型別檢查通過
- [x] 6.2 視覺確認：展開爭點卡片 → 立場在最上方、事實爭議預設收合、無 claims 區塊
- [x] 6.3 手動測試：重新分析爭點 → facts 存入 DB → 重載頁面 facts 仍在
