## Why

API route 的 request body 目前只有 `requireString` / `requireNumber` / `requireArray` 三個基本守衛，沒有 schema-level 驗證。Agent tool arguments 來自 Gemini JSON output，完全無 runtime 驗證——格式壞掉直接 runtime crash，AgentDO 中斷，用戶看到「生成失敗」。

引入 Zod 提供 runtime schema validation，同時統一 API route 和 agent tool 兩條路徑的驗證邏輯。

## What Changes

- 安裝 `zod` dependency
- 新增 `src/server/schemas/` 資料夾，為每個 route 和每個 agent tool 定義 Zod schema
- 改寫 `src/server/lib/validate.ts`：刪除 `requireString` / `requireNumber` / `requireArray`，替換為 `parseBody()` 和 `safeParseToolArgs()` 兩個函式
- 所有 API route 的 request body 驗證從手動 `requireString()` 呼叫改為 `parseBody(json, schema)`
- Agent tool executor 在 dispatch 前用 `safeParseToolArgs()` 驗證 arguments，失敗回傳 `toolError` 讓 Gemini 自我修正
- 統一錯誤回傳格式：API route 驗證失敗 → `{ error: string, details?: ZodIssue[] }`

## Capabilities

### New Capabilities
- `schema-validation`: Zod schema 定義、parseBody / safeParseToolArgs 驗證函式、錯誤格式規範
- `tool-args-validation`: Agent tool arguments 的 runtime Zod 驗證 + self-healing 流程（失敗回傳 toolError → Gemini 重試）

### Modified Capabilities

（無既有 spec 需修改）

## Impact

- **Dependencies**: 新增 `zod` package
- **Backend routes**: 所有有 request body 的 route（cases, files, briefs, damages, exhibits, timeline, law）
- **Agent system**: `src/server/agent/tools/index.ts`（tool executor）+ 每個 tool handler 的 args 型別
- **Error format**: API 驗證錯誤回傳增加可選 `details` 欄位，前端 `api.ts` 需對應處理
- **刪除**: `src/server/lib/validate.ts` 的 `requireString` / `requireNumber` / `requireArray` 及所有 import
