## Why

Step 2 的 `STRATEGY_JSON_SCHEMA` 範例寫死損害賠償 template 的 section 命名（「貳、前言」「參、事實及理由」「伍、結論」），導致使用其他 template 時 AI 輸出的 section 名稱與 template 不一致（Bug 2）。同時 AI 不知道哪些段落不該規劃（如證據方法），導致證據方法被 AI 和程式各產一份、重複出現在最終書狀中（Bug 3）。

兩個 bug 的共同根因：AI 不知道 template 裡哪些段落該它規劃、哪些不該碰，也不知道正確的段落名稱。

## What Changes

- 新增 `extractSections()` 純函式，從 template markdown 用中文編號（壹、貳、參…）解析段落清單，分類為 `fixed` / `ai_planned` / `system_generated`
- 泛化 `STRATEGY_JSON_SCHEMA` 的 JSON 範例，移除寫死的 section 命名，改用通用佔位符
- 泛化 `SECTION_RULES`，不再列舉特定 template 的段落名稱，改為「依範本結構」
- 泛化 `WRITING_CONVENTIONS`，移除「每份書狀應包含前言段落與結論段落」（與部分 template 矛盾）
- 在 `reasoningStrategyStep.ts` 組裝 prompt 時注入動態段落清單，明確告訴 AI 每個段落的名稱和分工
- 在 `briefPipeline.ts` 組裝時加防禦過濾，過濾 AI 誤產的證據方法段落（兜底）

## Capabilities

### New Capabilities
- `template-section-parser`: 從 template markdown 解析段落清單並分類分工（fixed / ai_planned / system_generated），供 prompt 動態注入

### Modified Capabilities

## Impact

- `src/server/agent/pipeline/templateHelper.ts` — 新增 `extractSections()`
- `src/server/agent/prompts/strategyConstants.ts` — 修改 `STRATEGY_JSON_SCHEMA`、`SECTION_RULES`、`WRITING_CONVENTIONS`
- `src/server/agent/pipeline/reasoningStrategyStep.ts` — 組裝時注入動態段落清單
- `src/server/agent/briefPipeline.ts` — 組裝時加防禦過濾
- `scripts/pipeline-test/test-extract-sections.ts` — 新增單元測試
