## 1. Setup

- [x] 1.1 安裝 `zod` dependency (`npm install zod`)
- [x] 1.2 建立 `src/server/schemas/` 資料夾結構

## 2. Core Validation Utilities

- [x] 2.1 改寫 `src/server/lib/validate.ts`：實作 `parseBody()` 函式（`safeParse` → 失敗 throw `badRequest`，回傳帶 `details` 的 error response）
- [x] 2.2 實作 `safeParseToolArgs()` 函式（`safeParse` → 失敗回傳格式化 error string，不 throw）
- [x] 2.3 從 `validate.ts` 刪除 `requireString` / `requireNumber` / `requireArray`

## 3. Route Schemas

- [x] 3.1 定義 `schemas/cases.ts`：`createCaseSchema`、`updateCaseSchema`
- [x] 3.2 定義 `schemas/briefs.ts`：`createBriefSchema`、`updateBriefSchema`
- [x] 3.3 定義 `schemas/files.ts`：`updateFileSchema`
- [x] 3.4 定義 `schemas/damages.ts`：`createDamageSchema`、`updateDamageSchema`
- [x] 3.5 定義 `schemas/law.ts`：`searchLawSchema`、`addLawRefsSchema`
- [x] 3.6 定義 `schemas/exhibits.ts`：`createExhibitSchema`、`updateExhibitSchema`、`reorderExhibitsSchema`
- [x] 3.7 定義 `schemas/timeline.ts`：`updateTimelineEventSchema`、`reorderTimelineSchema`
- [x] 3.8 定義 `schemas/templates.ts`：`createTemplateSchema`、`updateTemplateSchema`
- [x] 3.9 定義 `schemas/chat.ts`：`sendMessageSchema`
- [x] 3.10 定義 `schemas/briefVersions.ts`：`createVersionSchema`
- [x] 3.11 定義 `schemas/inlineAI.ts`：`inlineAISchema`

## 4. Tool Argument Schemas

- [x] 4.1 定義 `schemas/tools.ts`：所有 10 個 tool 的 Zod schemas（`readFileArgsSchema`、`searchLawArgsSchema`、`writeBriefSectionArgsSchema` 等），對齊 `definitions.ts` 的 `properties` 和 `required`
- [x] 4.2 建立 `toolSchemaMap: Record<string, ZodType>` 映射 tool name → schema

## 5. Route Migration

- [x] 5.1 遷移 `routes/cases.ts`：替換 `requireString` → `parseBody` + schema
- [x] 5.2 遷移 `routes/briefs.ts`：加入 `parseBody` 驗證
- [x] 5.3 遷移 `routes/files.ts`：加入 `parseBody` 驗證
- [x] 5.4 遷移 `routes/damages.ts`：加入 `parseBody` 驗證
- [x] 5.5 遷移 `routes/law.ts`：替換 `requireString` / `requireArray` → `parseBody` + schema
- [x] 5.6 遷移 `routes/exhibits.ts`：加入 `parseBody` 驗證
- [x] 5.7 遷移 `routes/timeline.ts`：加入 `parseBody` 驗證
- [x] 5.8 遷移 `routes/templates.ts`：替換 `requireString` → `parseBody` + schema
- [x] 5.9 遷移 `routes/chat.ts`：替換 `requireString` → `parseBody` + schema
- [x] 5.10 遷移 `routes/briefVersions.ts`：加入 `parseBody` 驗證
- [x] 5.11 遷移 `routes/inlineAI.ts`：替換 `requireString` → `parseBody` + schema

## 6. Tool Executor Integration

- [x] 6.1 修改 `src/server/agent/tools/index.ts` 的 `executeTool`：在 dispatch handler 前用 `safeParseToolArgs` 驗證，失敗回傳 `toolError`
- [x] 6.2 未註冊 schema 的 tool 跳過驗證並 `console.warn`（graceful fallback）

## 7. Cleanup & Verification

- [x] 7.1 確認無任何檔案 import `requireString` / `requireNumber` / `requireArray`
- [x] 7.2 執行 `npx tsc --noEmit` 確認型別正確
- [x] 7.3 執行 `npm run build` 確認 production build 成功
- [x] 7.4 用 prettier 格式化所有修改過的檔案
