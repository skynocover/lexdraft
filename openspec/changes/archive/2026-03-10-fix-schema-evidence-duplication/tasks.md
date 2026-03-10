## 1. Template Section Parser

- [x] 1.1 在 `templateHelper.ts` 新增 `extractSections(templateMd: string)` 函式，用中文編號（壹貳參肆伍陸柒捌玖拾）解析段落，回傳 `{ name: string; type: 'fixed' | 'ai_planned' | 'system_generated' }[]`
- [x] 1.2 在 `templateHelper.ts` 新增 `sectionsToPrompt(sections)` 函式，將段落清單轉為 prompt 注入文字
- [x] 1.3 新增 `scripts/pipeline-test/test-extract-sections.ts` 單元測試，驗證 6 個 template 的解析結果全部正確

## 2. 泛化 Prompt Constants

- [x] 2.1 修改 `strategyConstants.ts` 的 `STRATEGY_JSON_SCHEMA`，將 section 值改為通用佔位符
- [x] 2.2 修改 `strategyConstants.ts` 的 `SECTION_RULES`，移除寫死的段落名稱範例，改為「依範本結構」
- [x] 2.3 修改 `strategyConstants.ts` 的 `WRITING_CONVENTIONS`，移除「每份書狀應包含前言段落與結論段落」，改為「依範本結構決定」

## 3. 動態段落清單注入

- [x] 3.1 修改 `reasoningStrategyStep.ts`，在組裝 structuring prompt 和 reasoning prompt 時呼叫 `extractSections()` + `sectionsToPrompt()` 並注入結果

## 4. 防禦過濾

- [x] 4.1 修改 `briefPipeline.ts`，在組裝 `allParagraphs` 前從 AI writer 產出的段落中過濾掉 section 包含「證據」的段落

## 5. 驗證

- [x] 5.1 執行 `test-extract-sections.ts` 確認所有 assertions 通過
- [x] 5.2 執行 `npx tsc --noEmit` 確認無型別錯誤（pre-existing Zod v4 errors only）
- [x] 5.3 用 prettier 格式化所有修改的檔案
