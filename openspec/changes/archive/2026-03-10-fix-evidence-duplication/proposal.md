## Why

書狀 pipeline 的證據方法段落出現兩次：一次由 Step 2 AI 規劃並經 Step 3 writer 寫出完整論述，一次由 `evidenceFormatter` 程式化產出簡潔清單。根因是 writer loop 之前沒有邊界檢查，導致系統管理的 section 被 AI 重複產出，浪費 API token 且最終書狀內容重複。

## What Changes

- 在 `briefPipeline.ts` 的 writer loop 之前，過濾 `store.sections` 中屬於系統管理的 section（證據方法/證據），防止 AI writer 為這些 section 呼叫 API
- 在 `strategyConstants.ts` 的 `SECTION_RULES` 加入禁止規劃證據方法的指令，作為 prompt 層輔助防線
- 將 `AUTO_HEADINGS` 常數從 `templateRenderer.ts` 抽出為共用常數，避免重複定義

## Capabilities

### New Capabilities
- `system-managed-sections`: 定義「系統管理 section」的邊界機制 — 哪些 section 由程式產生、不允許 AI 規劃或撰寫

### Modified Capabilities

## Impact

- `src/server/agent/briefPipeline.ts` — writer loop 前新增過濾邏輯
- `src/server/agent/prompts/strategyConstants.ts` — SECTION_RULES 新增規則
- `src/server/agent/pipeline/templateRenderer.ts` — AUTO_HEADINGS 抽出為共用常數
- 無 API 變更、無 DB 變更、無前端變更
