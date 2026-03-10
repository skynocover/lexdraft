## 1. Prompt 常數拆分

- [x] 1.1 `strategyConstants.ts` — 新增 `DEFENSE_CLAIMS_RULES` 常數（答辯狀的 claims 攻防規則：theirs=原告主張、ours 多為 rebuttal、responds_to 必填）
- [x] 1.2 `strategyConstants.ts` — 新增 `DEFENSE_SECTION_RULES` 常數（答辯狀段落結構：壹答辯聲明→貳前言→參事實及理由→肆結論→伍證據方法，積極抗辯放結論前）
- [x] 1.3 `strategyConstants.ts` — 導出 `getClaimsRules(templateId)` 和 `getSectionRules(templateId)` 函式，根據 template_id 回傳對應常數
- [x] 1.4 `strategyConstants.ts` — 新增 `DEFENSE_JSON_SCHEMA` 常數（答辯狀的 JSON 範例，sections 結構反映答辯狀段落順序）

## 2. Reasoning Prompt 分支

- [x] 2.1 `reasoningStrategyPrompt.ts` — 新增 `DEFENSE_REASONING_WORKFLOW` 常數（三層推理：解構原告主張→防禦找舉證漏洞→攻擊積極抗辯）
- [x] 2.2 `reasoningStrategyPrompt.ts` — 將 `REASONING_STRATEGY_SYSTEM_PROMPT` 改為 `buildReasoningSystemPrompt(templateId)` 函式，共用部分抽出，根據 template_id 組裝攻擊或防禦工作流程
- [x] 2.3 更新 `reasoningStrategyStep.ts` 中呼叫 system prompt 的地方，改用新函式並傳入 `ctx.templateId`

## 3. Writer Instruction 分支

- [x] 3.1 `writerStep.ts` — 新增防禦模式的撰寫規則常數（反駁語氣、「原告主張...惟查...」句式、指出對方證據漏洞）
- [x] 3.2 `writerStep.ts` — `writeSection()` 中根據 `ctx.templateId` 切換撰寫規則，防禦模式 append 答辯狀專用規則

## 4. Step 0 路徑確認

- [x] 4.1 `caseAnalysisStep.ts` — 確認答辯狀 template 走 `existingDisputes` reuse 路徑的行為正確（disputes 已存在時跳過 orchestrator）— 已有 `hasUsableDisputes` 邏輯，無需修改
- [x] 4.2 `caseAnalysisStep.ts` — 確認 disputes 為空時仍走完整分析流程，不因 template_id 而報錯 — `else` 分支走完整 orchestrator，無 template_id 判斷

## 5. AgentDO Chatbot 更新

- [x] 5.1 `AgentDO.ts` — system prompt 新增書狀類型推斷規則：「答辯」→ defense template、「準備書狀」→ preparation template
- [x] 5.2 `AgentDO.ts` — system prompt 新增模糊意圖處理：根據 client_role + 已有書狀推斷類型，一句話確認

## 6. 驗證

- [ ] 6.1 用現有車禍案（被告視角）跑答辯狀 pipeline，檢查 Step 2 推理是否使用防禦框架
- [ ] 6.2 檢查產出的 claims 結構（theirs/ours/rebuttal 比例是否合理）
- [ ] 6.3 檢查產出的書狀語氣是否為逐點反駁（非主動攻擊）
- [ ] 6.4 用起訴狀 template 跑 pipeline，確認行為完全不變（regression）
