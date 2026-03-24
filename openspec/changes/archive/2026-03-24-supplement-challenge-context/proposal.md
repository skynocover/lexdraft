## Why

目前 briefMode 為 `supplement`（準備書狀）和 `challenge`（上訴狀）時，pipeline 缺少關鍵 context：準備書狀需要「對方書狀」才能逐點回應，上訴狀需要「原審判決」才能逐點指出錯誤。現有卷宗分類（5 類）無法區分「對方書狀」和「判決」，且 reasoning prompt 對所有 briefMode 一視同仁，沒有針對性的指引。

## What Changes

- 卷宗檔案分類從 5 類擴充為 6 類：`brief` 改名為 `brief_theirs`（對方書狀），從 `court` 拆出 `judgment`（判決），移除原本的 `brief`（因為我方書狀是可編輯的 briefs，不在卷宗檔案中）
- AI 檔案分類 prompt 和 fallback 分類邏輯更新為 6 類
- Pipeline 在 briefMode 為 supplement/challenge 時，從卷宗中提取焦點文件（brief_theirs / judgment）的 content_md，注入 Step 2 reasoning prompt 的專區
- Reasoning system prompt 根據 briefMode 追加 overlay 指引（supplement: 逐點回應對方主張；challenge: 逐點指出判決錯誤）
- 前端 categoryConfig 更新為 6 類，sidebar 分類 picker 同步更新

## Capabilities

### New Capabilities
- `file-category-expansion`: 卷宗檔案分類從 5 類擴充為 6 類（brief_theirs、judgment 取代 brief、court 拆分），包含 AI 分類 prompt、fallback 分類、前端 badge/picker
- `briefmode-focus-context`: Pipeline 根據 briefMode 提取焦點文件（對方書狀/判決）並以專區形式注入 reasoning prompt，加上 briefMode-specific 的 overlay 指引

### Modified Capabilities

（無既有 spec 需修改）

## Impact

- `src/server/queue/fileProcessor.ts` — AI 分類 prompt、schema enum、fallback 邏輯
- `src/client/lib/categoryConfig.ts` — 6 類 config（badge、label、顏色）
- `src/server/agent/pipeline/types.ts` — ReasoningStrategyInput 擴充
- `src/server/agent/briefPipeline.ts` — 提取焦點文件 content_md
- `src/server/agent/prompts/reasoningStrategyPrompt.ts` — overlay 常數 + 焦點專區注入
- `src/server/agent/pipeline/reasoningStrategyStep.ts` — 傳遞 briefMode 給 prompt builders
- `src/server/lib/exhibitAssign.ts` — 確認 getExhibitPrefix 不受影響（只認 exhibit_a/exhibit_b）
- 不需要 DB migration（category 欄位是 text）
- 舊檔案的 `brief` / `court` 值需在 categoryConfig 加 fallback 顯示
