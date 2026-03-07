## Context

目前 `briefPipeline.ts` 的 Step 3 Writer 逐段撰寫後，直接把 AI 產出的 paragraphs 存入 `briefs.content_structured`。產出的書狀只有「前言 → 事實及理由 → 結論」，缺少法院書狀的標準格式段落。

`cases` 表已有 `court`、`case_number`、`plaintiff`、`defendant`、`client_role` 欄位。`damages` 表已有各項金額資料。這些資料足夠組裝訴之聲明和首尾格式，不需要新增 DB 欄位。

`BRIEF_STRUCTURE_CONVENTIONS`（`strategyConstants.ts`）定義了 4 種 brief_type 的段落結構，AI 依此產出。目前起訴狀的結構從「壹、前言」開始，需要調整為從「貳」開始以配合 assembler 插入的「壹、訴之聲明」。

## Goals / Non-Goals

**Goals:**
- Pipeline 產出的書狀包含完整的法院格式：header（書狀標題、案號、當事人）、declaration（訴之聲明/答辯聲明）、footer（謹狀、法院、具狀人）
- 根據 brief_type 自動選擇正確的格式（當事人稱謂、聲明內容、證據前綴等）
- 組裝段落和 AI 段落使用相同的 Paragraph 結構，前端不需要修改
- 訴之聲明的金額從 damages 表自動計算

**Non-Goals:**
- 不改 DB schema（不新增欄位）
- 不改前端顯示邏輯
- 不做證據方法（assembleEvidence）
- 不做 Paragraph type 欄位區分
- 不做使用者可編輯的範本系統（B1）

## Decisions

### 1. Config 對照表而非 DB 儲存

**選擇**：briefAssembler 內部的常數物件，每種 brief_type 一筆設定。

**替代方案**：存到 `templates` 表讓使用者可編輯。

**理由**：這些是法院規定的固定格式（原告/被告稱謂、謹狀格式），不該讓使用者修改。書狀類型有限（4 種），不需要 DB 的靈活性。

### 2. 修改 BRIEF_STRUCTURE_CONVENTIONS 編號而非事後重新編號

**選擇**：在 `strategyConstants.ts` 中，讓有 declaration 的書狀類型（complaint、defense、appeal）的 AI body 從「貳」開始。

**替代方案**：AI 照舊從「壹」開始，assembler 事後用字串替換改編號。

**理由**：事後替換要改每個段落的 `section` 字串，可能和前端的 heading 渲染、爭點跳轉邏輯衝突。讓 AI 一開始就產出正確編號更安全。

### 3. 利息格式固定為「起訴狀繕本送達翌日」

**選擇**：不新增 `interest_start_date` 欄位，固定使用最常見的格式。

**理由**：大多數民事起訴狀使用此格式。律師如需特定日期，可在編輯器中手動修改。

### 4. 組裝段落不加特殊標記

**選擇**：assembler 產出的 Paragraph 和 AI 產出的結構完全相同，不加 `type` 欄位。

**理由**：目前不需要前端區分，加了是過度設計。未來如需區分，可以用 `dispute_id === null && !citations` 等既有欄位推斷。

## Risks / Trade-offs

- **AI 可能忽略編號指示** → 風險低，`BRIEF_STRUCTURE_CONVENTIONS` 是 AI 主要的結構參考，之前的調整（如禁 meta 段落）都有效果。如果 AI 偶爾產出「壹」而非「貳」，律師可手動修改。
- **damages 表為空時訴之聲明無金額** → 回傳不含金額的通用聲明（「被告應給付原告損害賠償金額，及自起訴狀繕本送達翌日起...」），律師再補填。
- **cases 表欄位為 null 時 header 不完整** → 跳過 null 欄位，只顯示有資料的部分。不會產出空行或佔位符。
