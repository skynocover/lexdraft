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
- **Document fields**: `_id` (`{pcode}-{條號}`), `pcode`, `law_name`, `nature`, `category`, `chapter`, `article_no`, `content`, `aliases`, `last_update`
- **Synonyms**: 137 groups in `synonyms` collection (e.g., 勞基法↔勞動基準法). Only works on smartcn-analyzed fields, not keyword fields. Cannot combine `fuzzy` + `synonyms`.
- **Law URL pattern**: `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode={pcode}`
- Keyword search only (not semantic) — concept queries have low precision

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
