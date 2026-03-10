## Context

LexDraft 的 pipeline 目前只有一組 prompt（起訴狀的攻擊模式）。答辯狀模板 `default-civil-defense` 已存在，但跑 pipeline 時仍用攻擊語氣撰寫，產出不符合答辯狀的邏輯結構。

現有 pipeline 流程：Step 0（案件分析）→ Step 1（法條查詢）→ Step 2（推理策略）→ Step 3（寫段落）。其中 Step 2 和 Step 3 的 prompt 需要根據書狀類型切換。

三個 prompt 檔案的現有結構：
- `reasoningStrategyPrompt.ts`：導出 `REASONING_STRATEGY_SYSTEM_PROMPT` 常數 + `buildReasoningStrategyInput()` 函式
- `strategyConstants.ts`：導出 `WRITING_CONVENTIONS`、`CLAIMS_RULES`、`SECTION_RULES`、`STRATEGY_JSON_SCHEMA` 常數
- `writerStep.ts`：`writeSection()` 函式中內嵌 instruction 字串

Step 0 已有 `existingDisputes` 複用邏輯（`caseAnalysisStep.ts` line 203-246），答辯狀可直接走此路徑。

## Goals / Non-Goals

**Goals:**
- Pipeline 根據 `template_id` 在 prompt 層面切換攻擊/防禦模式
- 答辯狀的推理邏輯：逆向解構（拆解原告主張）→ 防禦（舉證責任、反證）→ 反擊（積極抗辯）
- 答辯狀的寫作風格：逐點反駁語氣、「原告主張...惟查...」句式
- 準備書狀共用防禦模式
- AgentDO 能根據用戶意圖自動選擇正確的 template

**Non-Goals:**
- 不加 `brief_type` DB 欄位（template_id 就是書狀類型）
- 不做對方書狀結構化提取（靠 prompt 引導 AI 從 context 識別）
- 不做多書狀工作空間、並排檢視（另外做）
- 不做 Review Step（另外做）
- 不做前端 UI 變更

## Decisions

### D1：不新增 DB 欄位，用 template_id 決定 pipeline 行為

template_id 已編碼足夠資訊。Pipeline 直接用 `template_id` 判斷模式：

```typescript
if (templateId === 'default-civil-defense' || templateId === 'default-civil-preparation') {
  // 防禦模式 prompt
} else {
  // 攻擊模式 prompt（現有邏輯）
}
```

**為什麼不加 brief_type**：一個 template 對應一種書狀類型，額外欄位是冗餘。如果未來出現需要分離的情況（如「簡式答辯狀」和「完整答辯狀」），屆時加一個 ALTER TABLE 成本很低。

### D2：Prompt 拆分策略 — 共用 + 分支

三個檔案都用同樣的 pattern：把共用部分抽出，分支部分用 if/else 切換。

**reasoningStrategyPrompt.ts**：
- 共用（~70%）：工具說明、事實運用規則、時間軸運用、硬性規則
- 分支（~30%）：推理工作流程（攻擊 = 正向建構 vs 防禦 = 逆向解構）
- `REASONING_STRATEGY_SYSTEM_PROMPT` 改為函式 `buildSystemPrompt(templateId)`

**strategyConstants.ts**：
- `CLAIMS_RULES` 和 `SECTION_RULES` 各增加一個 defense 版本
- 新增 `DEFENSE_CLAIMS_RULES` 和 `DEFENSE_SECTION_RULES` 常數
- 導出函式 `getClaimsRules(templateId)` 和 `getSectionRules(templateId)`

**writerStep.ts**：
- `writeSection()` 的 instruction 字串中，撰寫規則加入防禦模式的分支
- 主要差異：反駁語氣、證據引用方式（指出對方證據漏洞 + 我方證據反駁）

### D3：答辯狀推理的三層框架

取代起訴狀的「請求權基礎分析 → 構成要件涵攝 → 攻防預判」：

| 層次 | 動作 | 起訴狀對應 |
|------|------|-----------|
| Layer 1: 解構 | 逐一拆解原告主張，分類「事實否認/法律爭執/全部承認」 | 請求權基礎分析 |
| Layer 2: 防禦 | 對否認/爭執的部分，找舉證責任漏洞、反證 | 構成要件涵攝 |
| Layer 3: 攻擊 | 積極抗辯（時效、過失相抵、損益相抵等） | 攻防預判 |

### D4：Step 0 答辯狀路徑

答辯狀走 `caseAnalysisStep.ts` 的 `existingDisputes` 路徑。需確認：
- 如果 disputes 為空但有 `category: 'brief'` 的對方書狀檔案，仍走完整分析流程
- 分析時 prompt 引導 AI 特別注意對方書狀中的主張
- 不需要額外的「主張提取」步驟

### D5：template_id 傳遞路徑

`template_id` 需要從 pipeline 入口一路傳到各 step：

```
briefPipeline.ts (ctx.templateId 已有)
  → runReasoningStrategy(ctx, store, ...) — ctx 已含 templateId
  → buildSystemPrompt(ctx.templateId) — 新函式
  → getClaimsRules(ctx.templateId) — 新函式
  → getSectionRules(ctx.templateId) — 新函式
  → writeSection(ctx, ...) — ctx 已含 templateId
```

`PipelineContext` 已有 `templateId` 欄位，不需要改介面。

### D6：AgentDO 智慧推斷

AgentDO system prompt 新增規則：
- 用戶明確說「答辯狀」→ `template_id: 'default-civil-defense'`
- 用戶明確說「準備書狀」→ `template_id: 'default-civil-preparation'`
- 用戶說「寫書狀」（模糊）→ 根據 `client_role` 和已有書狀推斷，用一句話確認

## Risks / Trade-offs

**[R1] 答辯狀 prompt 品質需要實測調整** → 先用現有車禍案測試，根據產出微調 prompt 文字。預期需要 2-3 輪迭代。

**[R2] 準備書狀共用防禦模式可能過於泛化** → Phase 1 先共用，如果品質不佳再為準備書狀加第三組 prompt。成本低（一個 else if）。

**[R3] AI 可能漏掉對方書狀中的主張** → 依賴 prompt 引導品質。如果實測發現常漏，Phase 2 再做結構化提取（fileProcessor 層面）。

**[R4] 自訂 template 無法自動推斷模式** → 目前無自訂 template 的使用場景。如有，fallback 到攻擊模式（最安全）。
