# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev              # Vite dev server (Workers + React HMR)
npm run build            # Production build
npm run preview          # Preview production build locally
npm run deploy           # wrangler deploy to Cloudflare
npm run db:generate      # Generate Drizzle migrations from schema
npm run db:migrate:local # Apply migrations to local D1
npx tsc --noEmit         # Type-check (no test framework configured)
node scripts/law-search-test/search-test.mjs  # Law search regression test (needs MongoDB)
```

## Architecture Overview

LexDraft is a legal document drafting platform for Taiwanese lawyers. Full-stack on Cloudflare Workers.

### Backend (`src/server/`)

- **Runtime**: Cloudflare Workers with Hono router
- **Entry**: `src/index.ts` — mounts API routes under `/api`, exports `AgentDO` Durable Object class, handles Queue consumer
- **Database**: D1 (SQLite) via Drizzle ORM. Schema at `src/server/db/schema.ts`, migrations in `./drizzle/`
- **Storage**: R2 bucket (`BUCKET`) for PDF files
- **Queue**: `FILE_QUEUE` for async PDF processing (`src/server/queue/fileProcessor.ts`) — uploads are parsed via `unpdf`, summarized by AI, and stored back
- **Auth**: Simple Bearer token middleware (`src/server/middleware/auth.ts`), token from `AUTH_TOKEN` env var

**API Routes** (`src/server/routes/`): `cases`, `files`, `chat`, `briefs`, `damages`, `law`

**Agent System** (`src/server/agent/`):

- `AgentDO` (Durable Object) runs an agentic tool-calling loop via Gemini 2.5 Flash through Cloudflare AI Gateway
- `tools/` — registry-based tool executor with 8 tools: `list_files`, `read_file`, `create_brief`, `write_brief_section`, `analyze_disputes`, `calculate_damages`, `search_law`, `generate_timeline`
- `tools/types.ts` defines `ToolHandler` and `ToolContext` interfaces; `tools/index.ts` is the executor entry point
- `sseParser.ts` — shared OpenAI-compatible SSE stream parser used by both tool handlers and AgentDO
- `toolHelpers.ts` — shared `toolError`, `toolSuccess`, `parseJsonField`, `loadReadyFiles`
- Brief writing uses Claude Citations API via `claudeClient.ts`

### Frontend (`src/client/`)

- **Framework**: React 19 + React Router v7 (client-side SPA)
- **State**: Zustand 5 stores in `src/client/stores/`:
  - `useAuthStore` — auth token
  - `useCaseStore` — current case + files
  - `useBriefStore` — briefs, lawRefs, citation management, undo/redo
  - `useAnalysisStore` — disputes, damages, timeline, parties (split from useBriefStore for re-render performance)
  - `useChatStore` — chat messages, SSE streaming, handles `brief_update` events to push into analysis/brief stores
  - `useTabStore` — workspace tab management
  - `useUIStore` — bottom panel state, UI toggles
- **Editor**: Tiptap v3 with custom extensions (`CitationNode`, `LegalHeading`, `LegalParagraph`) in `src/client/components/editor/tiptap/`
- **Styling**: Tailwind CSS v4 with custom dark theme tokens defined in `src/client/app.css` (e.g., `--color-bg-1`, `--color-t1`, `--color-ac`, `--color-bd`)

### Key Data Flow

1. User sends chat → `useChatStore` POSTs to `/api/cases/:id/chat` → creates Durable Object stub → AgentDO runs tool loop
2. AgentDO streams SSE events back: `thinking`, `tool_start`, `tool_result`, `brief_update`, `message`
3. `useChatStore.startStreaming()` parses SSE and dispatches to appropriate stores
4. Tool results (disputes, damages, timeline) go to `useAnalysisStore`; brief content goes to `useBriefStore`

## Critical Constraints

### MongoClient — MUST be per-request

`src/server/lib/lawSearch.ts` creates `new MongoClient()` per request and closes in `finally`. Do NOT refactor to a module-level singleton — Workers don't maintain TCP sockets between requests; a singleton's pooled connections go stale and hang.

### vite.config.ts `fix-punycode` plugin — DO NOT remove

The `optimizeDeps.esbuildOptions.plugins` entry fixes `mongodb → whatwg-url → tr46 → require("punycode/")` (trailing slash). Without it, esbuild leaves an unresolvable dynamic require that crashes at runtime.

### `nodejs_compat` NOT `nodejs_compat_v2`

`@cloudflare/vite-plugin`'s `unsafeModuleFallbackService` only activates with `nodejs_compat`. Using `nodejs_compat_v2` disables `node:` module fallback. With `compatibility_date >= 2024-09-23`, `nodejs_compat` already includes v2 features.

## Law Search (MongoDB Atlas Search)

- **DB**: `lawdb.articles` (221,061 articles), index `law_search`, analyzer `lucene.smartcn`
- **Env var**: `MONGO_URL` (mongodb+srv:// connection string)
- **Document fields**: `_id` (`{pcode}-{number}`，如 `B0000001-184`), `pcode`, `law_name`, `nature`, `category`, `chapter`, `article_no`（如 `第 184 條`）, `content`, `aliases`, `last_update`
- **Synonyms**: 137 groups in `synonyms` collection (e.g., 勞基法↔勞動基準法). Only works on smartcn-analyzed fields, not keyword fields. Cannot combine `fuzzy` + `synonyms`.
- **Law URL pattern**: `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode={pcode}`
- Keyword search only (not semantic) — concept queries have low precision

### 搜尋策略與已知限制（`lawSearch.ts`）

`searchWithCollection()` 有 3 層 fallback：

1. **Strategy 0 — `_id` 直查 O(1)**：搜尋「民法第184條」→ 解析出 `B0000001-184` → `findOne({ _id })`，~25ms
2. **Strategy 1 — regex 查詢**：Strategy 0 查不到時（如 PCODE_MAP 沒收錄的法規），用 `law_name` + `article_no` regex 匹配，~1000ms+
3. **Strategy 2 — Atlas Search 全文搜尋**：非條號查詢（如「民法 損害賠償」）走 compound query，~30ms
   - `buildLawClause()`: PCODE_MAP 有的法規用 `filter: pcode` 精確匹配，沒有的才 fallback `text` match on `law_name`
   - `article_no` 用 `phrase` match（不是 `text`，`text` 會因 smartcn 分詞匹配所有條文）
   - 0 結果時自動移除 `synonyms` 重搜一次

### 搜尋測試腳本

`scripts/law-search-test/search-test.mjs` — 52 個測試案例，驗證所有搜尋策略。修改 `lawSearch.ts` 或 `lawConstants.ts` 後務必跑一次。詳見 `scripts/law-search-test/README.md`。

注意：測試腳本中的 `PCODE_MAP` 和 `ALIAS_MAP` 是從 `lawConstants.ts` 複製的，修改 `lawConstants.ts` 後需同步更新測試腳本。

### `PCODE_MAP` 維護（`lawConstants.ts`）

- 來源：`/Users/ericwu/Documents/mojLawSplitJSON/FalVMingLing/` 中的 JSON（全國法規資料庫），檔名即 pcode
- 目前收錄 78 部常用法規，涵蓋民刑商勞行政稅法等領域
- 新增法規時從 FalVMingLing JSON 確認正確 pcode，不要猜測

### 概念搜尋已知限制

Atlas Search + smartcn 的概念搜尋對關鍵字選擇很敏感：

| 能搜到 | 搜不到 | 原因 |
|--------|--------|------|
| `民法 侵權行為` | `民法 精神慰撫金` | 法條用「慰撫金」不用「精神慰撫金」 |
| `民法 損害賠償` | `民法 不能工作 損失` | 法條用「勞動能力」不用「不能工作」 |
| `民法 毀損` | `民法 物之毀損` | 「物之」干擾 tokenization |
| `與有過失` | `過失傷害 賠償責任` | 純概念搜尋 recall 極低 |

優化方向：用更短、更接近法條原文的關鍵字；避免口語化的複合詞

## Critical Rules

### ✅ DO

- 使用 `lucide-react` 作為圖示庫，不要使用 inline SVG
- Tailwind 寬高值使用 spacing scale（如 `w-120`）而非任意值（如 `w-[480px]`）
- 使用 TypeScript，不要使用 `any` 類型
- 為每個函數定義參數和返回類型
- Always start by creating a detailed todo list for the current task.
- Check the todo list before starting each step, and update it after each step.
- 確認TODO.md 的內容 必要時可以修改 例如做完或是你認為需要加上或補充的
- 重構時，盡可能使用我給你的程式碼，而不是直接重寫一份新的，目的是讓畫面跟之前保持相同
- 除非Shadcn沒有或是我指定，不然只能使用Shadcn當作元件 而不是自己做一個
- 需要shadcn時 使用指令安裝新的shadcn元件
- 資料庫會使用D1, Drizzle ORM, 開發時使用本地D1
- 儲存檔案使用R2 開發時使用本地R2
- 在測試時 開啟了服務需要關閉 否則port會被佔用
- 使用axios而不是fetch
- function 使用 arrow function
- 使用`'` 而不是`"`
- 每次寫完程式碼後 使用.prettierrc來做format

### ❌ NEVER

- **不要修改 package.json 的依賴版本**
- **不要創建超過 300 行的組件文件**
- 不要換成Gemini api, 一率使用openrouter
- 不要自己寫CSS, 而是使用tailwind
- 不要使用Alchemy來做部署
- 不要擅自對正式區進行部署或執行任何命令

### ⚠️ IMPORTANT

如果 Claude 建議違反上述規則，請要求我（用戶）確認。
