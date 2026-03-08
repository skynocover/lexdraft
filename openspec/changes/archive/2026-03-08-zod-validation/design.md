## Context

目前後端有兩種驗證需求：

1. **API route request body**：18 個 `c.req.json<T>()` 呼叫散佈在 10 個 route 檔案中，只有 5 個用了 `requireString` / `requireArray` 做基本守衛，其餘完全無 runtime 驗證，只靠 TypeScript 類型標註。
2. **Agent tool arguments**：10 個 tool handler 接收 `args: Record<string, unknown>`，每個 handler 自己從 `args` 取值，零驗證。Gemini 回傳的 JSON 格式壞掉會導致 handler runtime crash → AgentDO 中斷。

已有基礎建設：
- `AppError` class + `badRequest()` / `notFound()` / `unauthorized()` helpers（`errors.ts`）
- `app.onError()` global handler（`index.ts`）
- `toolError()` / `toolSuccess()` 回傳格式（`toolHelpers.ts`）

## Goals / Non-Goals

**Goals:**
- 所有 API route 的 POST/PUT/PATCH body 有 Zod schema 驗證
- 所有 agent tool arguments 有 Zod schema 驗證，失敗回傳 `toolError` 觸發 Gemini self-healing
- 統一驗證入口：`parseBody()` for routes, `safeParseToolArgs()` for tools
- 刪除 `requireString` / `requireNumber` / `requireArray`，不與 Zod 共存

**Non-Goals:**
- 不安裝 `@hono/zod-validator`（自己包薄函式，維持現有 throw pattern）
- 不為 GET 請求的 query params 加 schema（目前都是 ID lookup，不需要）
- 不為前端加 Zod（前端已有 TypeScript 類型，input validation 是 UI 層的事）
- 不做 AI API retry / exponential backoff（屬於 Infra-0 Pipeline 錯誤恢復的範圍）

## Decisions

### D1: 自包 `parseBody()` 而非用 `@hono/zod-validator`

**選擇**：在 `validate.ts` 寫 `parseBody(raw, schema)` → `safeParse` → 失敗 throw `badRequest()`

**替代方案**：`@hono/zod-validator` middleware

**理由**：
- 現有 route pattern 是 inline throw，middleware 級別驗證反而多一層間接
- 避免多一個 dependency
- `@hono/zod-validator` 的錯誤回傳格式需要用 hook 客製才能對齊 `{ error: string }`，不如自己控制
- 整個邏輯不超過 10 行

### D2: Tool args 驗證失敗走 `toolError` self-healing

**選擇**：`safeParseToolArgs()` 失敗 → 回傳 `toolError('參數格式錯誤: ...')` → Gemini 看到錯誤訊息 → 自動修正 arguments 重試

**替代方案**：直接 throw → AgentDO catch → stream error event → 前端顯示失敗

**理由**：
- Gemini 的 JSON 格式錯誤通常是小問題（缺欄位、型別不對），error message 通常一次就修好
- throw 會中斷整個 tool loop，self-healing 讓對話繼續
- 符合 agent 工具的 graceful degradation 慣例

### D3: Schema 放在 `src/server/schemas/` 獨立資料夾

**選擇**：按 domain 分檔，如 `schemas/cases.ts`、`schemas/tools.ts`

**替代方案**：schema 放在各 route / tool handler 檔案內

**理由**：
- Tool schemas 和 route schemas 有些會共用欄位（如 `case_id`）
- 放在 route 裡會讓 tool executor import route 檔案（依賴方向不合理）
- 集中管理 schema 也方便未來前後端共用型別

### D4: 驗證錯誤回傳格式

**選擇**：`{ error: string, details?: ZodIssue[] }`

- `error`：第一個 issue 的 `message`（人可讀的單行描述）
- `details`：完整 ZodIssue 陣列（可選，方便 debug）

**理由**：
- `error` 欄位向後相容現有的 `{ error: string }` 格式
- `details` 只在驗證錯誤時出現，不影響其他錯誤回傳
- 前端 `api.ts` 已經從 `err.error` 取錯誤訊息，不需改動

### D5: Tool definitions 與 Zod schemas 的關係

**選擇**：兩者獨立維護。`definitions.ts` 的 JSON Schema 是給 Gemini 看的（function calling format），`schemas/tools.ts` 的 Zod schema 是 runtime 驗證用的。

**替代方案**：用 `zod-to-json-schema` 從 Zod 自動生成 tool definitions

**理由**：
- 多一個 dependency（`zod-to-json-schema`）
- Tool definitions 裡的 `description` 很長（有 prompt engineering 意義），不適合塞在 Zod schema 裡
- 兩者的 schema 幾乎不會分歧（工具參數穩定），手動同步的成本極低

## Risks / Trade-offs

- **[風險] Zod schema 跟 TS 類型 / tool definitions 不同步** → 遷移時一次性檢查所有欄位對齊。Tool definitions 的 `required` 欄位就是 Zod schema 的 non-optional 欄位，可交叉比對。
- **[風險] `safeParseToolArgs` 的錯誤訊息不夠讓 Gemini 理解** → 格式化為 `"參數格式錯誤: field_name — expected string, received undefined"`，清楚指出哪個欄位、期望什麼型別。
- **[取捨] 一次全遷移 vs 漸進式** → 選擇一次全遷移。尚未上線，沒有相容性包袱；兩套驗證系統並存會造成混淆。遷移量不大（~18 個 json parse 點 + 10 個 tool handler）。
