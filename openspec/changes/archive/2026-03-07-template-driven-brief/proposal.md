## Why

目前書狀系統依賴 `briefType`（complaint/defense/preparation/appeal）驅動結構、prompt、assembler、UI 顯示。這造成三個問題：

1. **擴展困難**：新增書狀類型（家事、強制執行、勞動）需要改 assembler config、fallback structures、briefTypeConfig、prompt 等多處程式碼
2. **Template 與實際產出脫節**：現有 8 個百科全書式預設範本（每個 ~190 行）涵蓋整個類別，AI 不知道該聚焦哪種書狀，導致產出不符合 template 結構
3. **Header/Footer 不夠彈性**：不同案件類型的當事人稱謂（原告/被告 vs 債權人/債務人）、法院庭別（民事庭 vs 家事法庭）、header 欄位數量都不同，hardcoded assembler 無法涵蓋

改為 template-driven 設計：一份 template = 一種具體書狀的完整骨架（含 header/footer 格式 + 段落結構 + AI 撰寫指引），系統從 template 內容得知一切，不再需要 briefType。

## What Changes

- **BREAKING**: 移除 `briefType` 概念 — 從 DB schema、pipeline、agent tools、prompts、前端全面移除 `complaint|defense|preparation|appeal` enum
- **BREAKING**: `briefs.brief_type` 欄位改為 `briefs.template_id`（記錄生成時使用的範本）
- 刪除 `briefAssembler.ts` — header/declaration/footer 不再由 hardcoded config 產生，改由 Gemini Flash Lite 根據 template 格式 + 案件資料填入
- 重寫 `defaultTemplates.ts` — 從 8 個百科全書式範本（共 1430 行）改為 4-8 個具體書狀骨架（每個 30-50 行），來源為 ref/templates
- 刪除 `briefTypeConfig.ts`（前端）— UI 改用 brief.title 顯示
- 刪除 `BRIEF_TYPE_FALLBACK_STRUCTURES` + `getStructureGuidance()` — template 本身就是結構指引
- Pipeline Step 3 改為三軌生成：Flash Lite（header + 靜態段落 + footer）、Flash/Sonnet（AI 段落）、Code（證據方法從 exhibits 表格式化）
- Strategy agent 改為接收 template 全文，自行判斷哪些段落是靜態、哪些需要 AI 撰寫
- Agent 工具 `create_brief` / `write_full_brief` 參數從 `brief_type` enum 改為 `template_id`
- Orchestrator 保留 AI 自動選範本功能（從預設範本清單中選擇）

## Capabilities

### New Capabilities

- `template-format`: Template 格式定義與預設範本 — 定義 template markdown 格式（header/body/footer 三區域）、placeholder 慣例（【待填】紅字）、預設範本內容（從 ref/templates 濃縮）
- `template-rendering`: Template 渲染（Flash Lite）— 用 Gemini Flash Lite 將 template 的 header、靜態段落、footer 與案件資料合併，產出填好資料的段落
- `evidence-formatter`: 證據方法程式化生成 — 從 exhibits 表格式化產出「甲證一　xxx」列表

### Modified Capabilities

（無既有 specs）

## Impact

**後端（~20 個檔案）**
- Pipeline 核心：`briefPipeline.ts`、`pipeline/types.ts`、`contextStore.ts`、`caseAnalysisStep.ts`、`reasoningStrategyStep.ts`、`writerStep.ts`、`templateHelper.ts`
- Agent tools：`definitions.ts`、`createBrief.ts`、`writeFullBrief.ts`、`qualityReview.ts`、`orchestratorAgent.ts`
- Prompts：`orchestratorPrompt.ts`、`reasoningStrategyPrompt.ts`、`qualityReviewerPrompt.ts`、`strategyConstants.ts`
- Routes：`briefs.ts`、`templates.ts`
- DB：`schema.ts` + 1 migration（briefs.brief_type → template_id）
- 刪除：`briefAssembler.ts`、`defaultTemplates.ts`（重寫）

**前端（~6 個檔案）**
- Stores：`useBriefStore.ts`、`useChatStore.ts`/`sseHandlers.ts`
- Components：`BriefsSection.tsx`、`TabBar.tsx`、`CaseWorkspace.tsx`
- 刪除：`briefTypeConfig.ts`

**不動的部分**
- templates 表結構、TemplateEditor UI、CaseInfoTab
- Writer 的 Claude Citations 邏輯、lawSearch、damages/disputes/claims
- SSE streaming、exhibit 管理、Pipeline Step 0/1 核心
