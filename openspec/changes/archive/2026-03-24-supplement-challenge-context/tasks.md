## 1. 卷宗分類擴充

- [x] 1.1 `src/client/lib/categoryConfig.ts` — 更新為 6 類 config（brief_theirs、exhibit_a、exhibit_b、judgment、court、other），加上舊值 `brief` 的 fallback entry
- [x] 1.2 `src/server/queue/fileProcessor.ts` — AI 分類 prompt 改為 6 類 enum、CLASSIFICATION_SCHEMA 更新、fallbackClassify 更新檔名關鍵字邏輯
- [x] 1.3 驗證 `src/server/lib/exhibitAssign.ts` 的 `getExhibitPrefix()` 不受影響（只認 exhibit_a/exhibit_b）

## 2. Pipeline 焦點文件提取

- [x] 2.1 `src/server/agent/prompts/strategyConstants.ts` — 新增 `FOCUS_DOC_MAX_LENGTH = 8000` 常數
- [x] 2.2 `src/server/agent/pipeline/types.ts` — `ReasoningStrategyInput` 新增 `briefMode` 和 `focusDocuments` 欄位（`Array<{ filename: string; fileId: string; content: string }>` 或 null）
- [x] 2.3 `src/server/agent/briefPipeline.ts` — 組裝 strategyInput 時，根據 `ctx.briefMode` 從 `fileContentMap` 過濾 brief_theirs / judgment 檔案，取 content_md（fallback full_text）截斷後放入 `focusDocuments`

## 3. Reasoning Prompt 改造

- [x] 3.1 `src/server/agent/prompts/reasoningStrategyPrompt.ts` — 新增 `SUPPLEMENT_OVERLAY` 和 `CHALLENGE_OVERLAY` 常數
- [x] 3.2 `src/server/agent/prompts/reasoningStrategyPrompt.ts` — `buildReasoningSystemPrompt(mode, briefMode)` 加第二參數，在 base workflow 後追加 overlay
- [x] 3.3 `src/server/agent/prompts/reasoningStrategyPrompt.ts` — `buildReasoningStrategyInput()` 根據 input.focusDocuments 在 `[案件檔案摘要]` 之後插入焦點專區
- [x] 3.4 `src/server/agent/pipeline/reasoningStrategyStep.ts` — 把 `ctx.briefMode` 傳給 `buildReasoningSystemPrompt` 和 `buildReasoningStrategyInput`

## 4. 驗證

- [x] 4.1 `npx tsc --noEmit` — 型別檢查通過
- [ ] 4.2 手動驗證：上傳對方書狀 PDF → 確認分類為 brief_theirs → sidebar 顯示 [對] badge（需跑 dev server）
- [ ] 4.3 手動驗證：supplement 模式生成書狀 → 確認 reasoning prompt 包含焦點專區和 overlay（需跑 dev server）
