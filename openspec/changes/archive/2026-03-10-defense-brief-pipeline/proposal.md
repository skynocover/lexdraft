## Why

LexDraft 目前的 pipeline 只支援起訴狀（攻擊模式），但台灣民事訴訟中約一半的書狀是答辯狀和準備書狀（防禦模式）。被告律師無法使用 LexDraft 撰寫答辯狀，產品覆蓋的使用場景不完整。答辯狀模板（`default-civil-defense`）已存在，但 pipeline 的 reasoning prompt 和 writer instruction 只有攻擊模式，需要加入防禦模式的分支。

## What Changes

- Pipeline 根據 `template_id` 判斷書狀模式（攻擊 vs 防禦），在三個 prompt 檔案中加入防禦分支
- `reasoningStrategyPrompt.ts`：新增答辯狀 reasoning 指令（逆向解構 → 防禦 → 反擊三層推理）
- `strategyConstants.ts`：新增答辯狀的段落結構規則和 claims 規則
- `writerStep.ts`：新增答辯狀 writer instruction（逐點反駁語氣、「原告主張...惟查...」句式）
- `caseAnalysisStep.ts`：答辯狀走 reuse disputes 路徑（複用現有爭點分析，不重跑 orchestrator）
- `AgentDO` system prompt：智慧推斷書狀類型，律師說「寫答辯狀」時自動選 `default-civil-defense` template
- 準備書狀共用防禦模式，prompt 加一句「聚焦回應對方最新主張」

### 不做的事

- **不加 `brief_type` DB 欄位** — template_id 就是書狀類型，勿增實體
- **不做對方書狀結構化提取** — 靠 prompt 引導 AI 從 context 識別對方主張
- **不做多書狀工作空間** — 另外做（TODO P2.5-1）
- **不做 Review Step** — 另外做（TODO P2.5-2）
- **不做並排檢視** — 另外做

## Capabilities

### New Capabilities

- `defense-prompt-branch`: Pipeline prompt 的防禦模式分支 — 涵蓋 reasoning prompt、strategy constants、writer instruction 三個檔案的答辯狀版本，以及 pipeline 根據 template_id 切換分支的邏輯
- `defense-chatbot-routing`: AgentDO chatbot 智慧推斷書狀類型 — 根據用戶意圖和 client_role 自動選擇對應 template

### Modified Capabilities

## Impact

- `src/server/agent/prompts/reasoningStrategyPrompt.ts` — 新增防禦模式 reasoning 指令
- `src/server/agent/prompts/strategyConstants.ts` — 新增答辯狀結構規則 + claims 規則
- `src/server/agent/pipeline/writerStep.ts` — 根據 template_id 切換 writer instruction
- `src/server/agent/pipeline/briefPipeline.ts` — 傳遞 template_id 給各 step
- `src/server/agent/pipeline/caseAnalysisStep.ts` — 確認答辯狀走 reuse disputes 路徑
- `src/server/durable-objects/AgentDO.ts` — system prompt 更新，智慧推斷書狀類型
