## 1. Data Model & DB

- [x] 1.1 `defaultTemplates.ts` — `DefaultTemplate` 介面新增 `briefMode` 屬性，6 個預設模板各自設定值
- [x] 1.2 `schema.ts` — `templates` 表新增 `brief_mode` text 欄位
- [x] 1.3 Drizzle migration — 產生並執行 migration（新增欄位 + 刪除所有 `is_default=0` 記錄）

## 2. Pipeline 路由重構

- [x] 2.1 `strategyConstants.ts` — 新增 `BriefMode` type 和 `resolvePipelineMode(briefMode, clientRole)` 函式，移除 `isDefenseTemplate()`
- [x] 2.2 `strategyConstants.ts` — `getClaimsRules`、`getSectionRules`、`getJsonSchema` 改為接收 `pipelineMode: 'claim' | 'defense'`
- [x] 2.3 `reasoningStrategyPrompt.ts` — `buildReasoningSystemPrompt` 改為接收 `briefMode` + `clientRole`，內部呼叫 `resolvePipelineMode`
- [x] 2.4 `writerPrompt.ts` — `isDefenseTemplate(templateId)` 改為使用 `pipelineMode`
- [x] 2.5 Pipeline 呼叫端 — `reasoningStrategyStep.ts`、`writerStep.ts`、`briefPipeline.ts` 等傳遞 `briefMode` 和 `clientRole`

## 3. 後端 API

- [x] 3.1 `schemas/templates.ts`（或對應 schema）— 新增 `brief_mode` Zod validation
- [x] 3.2 `routes/templates.ts` — `POST` 和 `PUT` handler 支援 `brief_mode` 參數讀寫
- [x] 3.3 Pipeline 中 `briefMode` 解析 — 系統模板從 `defaultTemplates.ts` 讀取，自訂模板從 DB 讀取，fallback `'claim'`（在 `writeFullBrief.ts` 中實作 `resolveBriefMode`）

## 4. 前端 — 新增自訂範本 Dialog

- [x] 4.1 建立 `NewTemplateDialog` 元件 — 名稱 input + 書狀性質 radio group + 選中說明文字 + 建立/取消按鈕
- [x] 4.2 `CaseInfoTab.tsx` — 「新增自訂範本」按鈕改為開啟 `NewTemplateDialog`
- [x] 4.3 `useTemplateStore.ts` — `createTemplate` 改為接收 `title` + `briefMode` 參數

## 5. 前端 — TemplateEditor 工具列

- [x] 5.1 `TemplateEditor.tsx` — 自訂模板工具列新增書狀性質 `Select` 下拉選單
- [x] 5.2 `useTemplateStore.ts` — 新增 `setBriefMode` action，修改後標記 dirty 觸發 auto-save
- [x] 5.3 `TemplateSummary` / `Template` 介面新增 `brief_mode` 欄位

## 6. 常數與標籤

- [x] 6.1 建立 `BRIEF_MODE_OPTIONS` 常數陣列（value、label、description），前端 Dialog 和 TemplateEditor 共用
