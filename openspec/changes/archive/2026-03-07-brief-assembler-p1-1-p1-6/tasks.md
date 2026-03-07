## 1. briefAssembler 建立

- [x] 1.1 建立 `src/server/agent/pipeline/briefAssembler.ts`，定義 4 種 brief_type 的 config 對照表（title、partyLabels、declaration type、courtSuffix）
- [x] 1.2 實作 `assembleHeader(briefType, caseRow)` — 產出書狀標題、案號、當事人段落，null 欄位跳過
- [x] 1.3 實作 `assembleDeclaration(briefType, damages)` — complaint 從 damages 計算金額 + 利息 + 假執行；defense 產出駁回聲明；preparation 回傳空；appeal 產出上訴聲明
- [x] 1.4 實作 `assembleFooter(briefType, caseRow)` — 產出謹狀、法院名稱、具狀人

## 2. Pipeline 整合

- [x] 2.1 修改 `briefPipeline.ts`，在 Step 3 Writer 完成後，將 assembler 段落插入 AI body 前後，組成完整 paragraphs 陣列
- [x] 2.2 確認 caseRow select 已包含 `court`、`plaintiff`、`defendant`、`client_role` 欄位（使用 store.caseMetadata + store.parties）

## 3. AI 編號調整

- [x] 3.1 修改 `strategyConstants.ts` 的 `BRIEF_TYPE_FALLBACK_STRUCTURES`，complaint/defense/appeal 的 AI body 從「貳」開始，preparation 維持「壹」不變
- [x] 3.2 在 WRITING_CONVENTIONS + fallback structures 中加入「壹、訴之聲明由系統自動產生」的提示，讓 AI 不要重複產出聲明段

## 4. 驗證

- [ ] 4.1 本地跑一次 complaint pipeline，確認產出書狀包含 header + declaration + body + footer
- [x] 4.2 確認 preparation pipeline 不產出 declaration，編號從壹開始
- [x] 4.3 確認 cases 欄位為 null 時 header/footer 使用【待填】placeholder
- [x] 4.4 npx tsc --noEmit 通過
