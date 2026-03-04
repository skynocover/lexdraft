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
npx tsx scripts/law-search-test/search-test.ts  # Law search regression test (needs MongoDB + MONGO_API_KEY for hybrid tests)
npx tsx scripts/pipeline-test/test-law-fallback.ts  # Law fallback unit test (no external deps)
npx tsx scripts/pipeline-test/pipeline-benchmark.ts  # Pipeline citation benchmark (needs dev server running)
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
- `tools/` — registry-based tool executor with 10 tools: `list_files`, `read_file`, `create_brief`, `write_brief_section`, `write_full_brief`, `analyze_disputes`, `calculate_damages`, `search_law`, `generate_timeline`, `review_brief`
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

### U+FFFD 清除 — 兩個 AI Gateway 邊界，共用 `stripFFFD()`

Cloudflare AI Gateway 代理 chunked response 時偶爾在 multi-byte UTF-8 邊界切壞字元，產生 U+FFFD。清除策略：

- **共用函式**：`src/server/lib/sanitize.ts` 的 `stripFFFD()` 是唯一存放 regex 的地方
- **Gemini 邊界**：`sseParser.ts` 的 `parseOpenAIStream()` — 清除 `delta.content` 和 `delta.tool_calls[].function.arguments`
- **Claude 邊界**：`claudeClient.ts` — 清除 `block.text`、`cited_text`；`label` 使用本地 `doc.title`（不依賴 AI echo）

**不要在下游（stores、components、DB writes）加任何 U+FFFD 處理。** 所有清除只在上述兩個邊界進行。

## Law Search (MongoDB Atlas Search + Vector Search)

> 完整文檔見 `docs/law-search.md`（DB schema、搜尋策略、CONCEPT_TO_LAW 改寫表、已知限制）

- **核心檔案**：`src/server/lib/lawSearch.ts`（搜尋邏輯）、`src/server/lib/lawConstants.ts`（PCODE_MAP、CONCEPT_TO_LAW）
- **Env var**：`MONGO_URL`（連線字串）、`MONGO_API_KEY`（Voyage AI embedding，vector search 用）
- **MongoClient 必須 per-request**（見上方 Critical Constraints）
- **測試**：`npx tsx scripts/law-search-test/search-test.ts`，修改 `lawSearch.ts` 或 `lawConstants.ts` 後務必跑

## Local D1 Database Queries

查詢本地 D1 資料庫使用 `wrangler d1 execute`：

```bash
# 基本查詢（加 --json 方便程式解析）
npx wrangler d1 execute lexdraft-db --local --command "SQL" --json 2>/dev/null

# 列出所有表
npx wrangler d1 execute lexdraft-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"

# 查詢特定表的欄位
npx wrangler d1 execute lexdraft-db --local --command "PRAGMA table_info(cases)"
```

重點：

- 一律加 `--local`，不要用 `--remote`（不要動正式區）
- database name 是 `lexdraft-db`（來自 `wrangler.jsonc`）
- Schema 定義在 `src/server/db/schema.ts`

### D1 Table Schema Quick Reference

| Table              | PK  | Key Columns                                                                                         | JSON Columns                                                                                           |
| ------------------ | --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **cases**          | id  | user_id, title, case_number, court, case_type, plaintiff, defendant, client_role, case_instructions | law_refs (`[{id,law_name,article,full_text,is_manual}]`), timeline                                     |
| **briefs**         | id  | case_id, brief_type, title, version                                                                 | content_structured (`{paragraphs:[{id,section,subsection,content_md,segments,citations,dispute_id}]}`) |
| **files**          | id  | case_id, filename, r2_key, status, category, doc_date, full_text, summary, content_md               | —                                                                                                      |
| **claims**         | id  | **case_id** (not brief_id!), side, claim_type, statement, assigned_section, dispute_id, responds_to | —                                                                                                      |
| **disputes**       | id  | case_id, number, title, our_position, their_position                                                | evidence, law_refs                                                                                     |
| **damages**        | id  | case_id, category, description, amount, basis, dispute_id                                           | evidence_refs                                                                                          |
| **messages**       | id  | case_id, role, content                                                                              | metadata                                                                                               |
| **brief_versions** | id  | brief_id, version_no, label, content_structured, created_by                                         | content_structured (same as briefs)                                                                    |

⚠️ **常見陷阱**：`claims` 表的外鍵是 `case_id`，不是 `brief_id`。`content_structured` 只在 `briefs` 和 `brief_versions` 表，不在 `cases` 表。

## Critical Rules

### ✅ DO

- 使用 `lucide-react` 作為圖示庫，不要使用 inline SVG
- Tailwind 寬高值使用 spacing scale（如 `w-120`）而非任意值（如 `w-[480px]`）
- Tailwind opacity 使用整數簡寫（如 `bg-white/2`、`bg-t3/8`）而非任意值（如 `bg-white/[0.02]`、`bg-t3/[0.08]`）
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
