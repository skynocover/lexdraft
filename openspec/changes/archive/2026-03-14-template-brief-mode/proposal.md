## Why

Pipeline 目前用 `isDefenseTemplate()` 硬編碼比對 template ID 來決定書狀的攻防模式。這造成兩個問題：(1) 準備書狀被永遠歸為防禦模式，但原告也會寫準備書狀；(2) 新增模板必須改 code，未來客製模板無法自動對應正確的 prompt 策略。

## What Changes

- 在 `DefaultTemplate` 介面和 DB `templates` 表新增 `brief_mode` 屬性，值為 `claim | defense | challenge | supplement | petition`
- 6 個系統預設模板各自設定對應的 `brief_mode`
- Pipeline 中 `isDefenseTemplate()` 及相關 helper（`getClaimsRules`、`getSectionRules`、`getJsonSchema`）改為讀取 `briefMode` 而非比對 template ID
- `supplement` 模式 fallback：根據 `client_role` 決定使用 claim 或 defense prompt（Phase 1，不新增專屬 prompt）
- `challenge` 和 `petition` 模式 fallback 到 `claim` prompt（Phase 1）
- 前端「新增自訂範本」從直接建立改為 Dialog，要求填寫名稱 + 選擇書狀性質
- TemplateEditor 工具列新增書狀性質下拉選單，允許事後修改
- Migration 中刪除現有所有自訂模板（尚未上線，無資料遷移風險）

## Capabilities

### New Capabilities
- `brief-mode-attribute`: Template 的 `brief_mode` 屬性定義、DB schema、預設模板對應、pipeline 路由邏輯
- `template-creation-dialog`: 新增自訂範本時的 Dialog UI（名稱 + 書狀性質選擇 + 選中後顯示說明文字）
- `template-mode-editor`: TemplateEditor 工具列中的書狀性質下拉選單（事後修改用）

### Modified Capabilities

## Impact

- **DB**: `templates` 表新增 `brief_mode` 欄位 + migration
- **後端 API**: `POST /templates` 和 `PUT /templates/:id` 需支援 `brief_mode` 參數
- **Pipeline**: `strategyConstants.ts`、`reasoningStrategyPrompt.ts`、`writerPrompt.ts`、`writerStep.ts` 中的模式判斷邏輯
- **前端**: `useTemplateStore.ts`、`CaseInfoTab.tsx`（新增 Dialog）、`TemplateEditor.tsx`（工具列下拉）
- **預設模板**: `defaultTemplates.ts` 介面擴充
