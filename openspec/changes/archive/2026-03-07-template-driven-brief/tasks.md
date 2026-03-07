## 1. DB Schema & Migration

- [x] 1.1 修改 `db/schema.ts`：briefs 表移除 `brief_type`，新增 `template_id`（text, nullable）
- [x] 1.2 建立 DB migration（`npm run db:generate`），apply 到 local D1

## 2. 預設範本內容

- [x] 2.1 從 ref/templates 濃縮 4-8 個具體書狀 markdown 骨架（每個 30-50 行），含 header/body/footer
- [x] 2.2 重寫 `defaultTemplates.ts`：用新的短 markdown 取代百科全書式內容，移除 `autoSelectTemplate()`

## 3. 移除 briefType — 後端核心

- [x] 3.1 刪除 `briefAssembler.ts`
- [x] 3.2 修改 `pipeline/types.ts`：PipelineContext、ReasoningStrategyInput 等型別中 `briefType` → `templateId`
- [x] 3.3 修改 `contextStore.ts`：移除 `briefType` 欄位，可加 `templateTitle`
- [x] 3.4 修改 `caseAnalysisStep.ts`：template 載入改為直接讀 case.template_id，移除 autoSelectTemplate 呼叫

## 4. Flash Lite 渲染

- [x] 4.1 新增 Flash Lite 渲染函式：接收 template header/靜態段落/footer + case data，呼叫 Gemini Flash Lite 填入資料
- [x] 4.2 修改 `briefPipeline.ts`：Step 3 中 assembler 呼叫改為 Flash Lite 渲染 call

## 5. 證據方法格式化

- [x] 5.1 新增證據方法格式化函式：從 exhibits 表查詢 → 按 prefix/number 排序 → 格式化為「甲證一　xxx」列表
- [x] 5.2 整合到 `briefPipeline.ts`：在 writer loop 後、footer 前插入證據方法段落

## 6. Pipeline 整合

- [x] 6.1 修改 `briefPipeline.ts`：Step 3 改為三軌（Flash Lite + AI writer + Code），按 template 段落順序組裝
- [x] 6.2 修改 `reasoningStrategyStep.ts`：傳 template 全文給 strategy agent，移除 getStructureGuidance()
- [x] 6.3 修改 `writerStep.ts`：prompt 中 `書狀類型` → `書狀名稱`（template title）
- [x] 6.4 修改 `templateHelper.ts`：簡化為只傳 template 全文（已是最簡形式）

## 7. 移除 briefType — Agent Tools & Prompts

- [x] 7.1 修改 `tools/definitions.ts`：create_brief 和 write_full_brief 參數 `brief_type` enum → `template_id` string
- [x] 7.2 修改 `tools/createBrief.ts`：建 brief 時存 template_id 而非 brief_type
- [x] 7.3 修改 `tools/writeFullBrief.ts`：傳 templateId 給 pipeline
- [x] 7.4 修改 `tools/qualityReview.ts`：briefType → template title
- [x] 7.5 修改 `orchestratorAgent.ts`：傳 templateId，支援 AI 自動選 template
- [x] 7.6 修改 `durable-objects/AgentDO.ts`：orchestrator prompt 改為 template 選擇指引

## 8. 移除 briefType — Prompts

- [x] 8.1 修改 `orchestratorPrompt.ts`：「決定 brief_type」→「選擇 template」，附上預設範本清單
- [x] 8.2 修改 `reasoningStrategyPrompt.ts`：`[書狀類型]` → `[書狀範本]`，段落編號規則改為依 template
- [x] 8.3 修改 `qualityReviewerPrompt.ts`：briefType → template 資訊
- [x] 8.4 修改 `strategyConstants.ts`：刪除 BRIEF_TYPE_FALLBACK_STRUCTURES、getStructureGuidance()，簡化 WRITING_CONVENTIONS，加入無 template 時的通用 fallback 指引

## 9. 移除 briefType — Routes

- [x] 9.1 修改 `routes/briefs.ts`：POST 改用 template_id，GET 回傳 template_id 而非 brief_type
- [x] 9.2 修改 `routes/templates.ts`：預設範本來源已自動更新（使用 defaultTemplates.ts）

## 10. 移除 briefType — 前端

- [x] 10.1 刪除 `briefTypeConfig.ts`
- [x] 10.2 修改 `useBriefStore.ts`：Brief 型別 brief_type → template_id，刪除 updateBriefType()
- [x] 10.3 修改 `useChatStore.ts` / `sseHandlers.ts`：移除 brief_type 引用
- [x] 10.4 修改 `BriefsSection.tsx`：badge 改用 brief.title
- [x] 10.5 修改 `TabBar.tsx`：label 改用 brief.title
- [x] 10.6 修改 `CaseWorkspace.tsx`：移除 briefType 引用

## 11. 驗證

- [x] 11.1 TypeScript 編譯通過（`npx tsc --noEmit`）
- [ ] 11.2 用車禍案測試完整 pipeline：template 選擇 → strategy → writer → 最終書狀包含 header/AI 段落/證據方法/footer（需手動測試）
- [ ] 11.3 測試無 template 的 fallback 路徑（需手動測試）
