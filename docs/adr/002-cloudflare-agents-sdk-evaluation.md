# ADR-002: Cloudflare Agents SDK 遷移評估

**日期**: 2026-03-09
**狀態**: 不採用
**決策者**: Eric Wu

## 背景

Cloudflare 於 2025 年推出 [Agents SDK](https://github.com/cloudflare/agents)，提供建立在 Durable Objects 之上的高階抽象層，內建 state 持久化、message persistence、resumable streaming、tool calling、scheduling 等功能。評估是否應將現有 `AgentDO` 遷移至 Agents SDK 以改善維護性。

## Cloudflare Agents SDK 概述

### 核心架構

SDK 提供三層類別：

| 層級    | 類別                | 用途                                                     |
| ------- | ------------------- | -------------------------------------------------------- |
| Layer 1 | `Agent<Env, State>` | 基礎 agent，自動 state 持久化到 DO 內建 SQLite           |
| Layer 2 | `AIChatAgent`       | 聊天專用，內建 message persistence + resumable streaming |
| Layer 3 | React hooks         | `useAgent()` + `useAgentChat()` 前端整合                 |

### 主要功能

- **State 管理**：`this.state` / `this.setState()` 自動序列化到 DO SQLite
- **Message 持久化**：`this.messages` 自動存取，支援 `maxPersistedMessages` 上限
- **Resumable streaming**：斷線重連後自動補發遺漏的 chunks
- **Tool patterns**：server-side（自動執行）、client-side（瀏覽器執行）、approval（人工確認）
- **`@callable()` 裝飾器**：把方法變成 typed WebSocket RPC
- **Scheduling**：`this.schedule()` 支援 Date、delay、cron
- **MCP**：內建 MCP server/client

### 關鍵依賴

底層使用 **Vercel AI SDK**（`streamText`, `generateText`, `tool()`）做 model 抽象，支援 `@ai-sdk/openai`, `@ai-sdk/anthropic`, `workers-ai-provider` 等 adapter。

## 現有架構

```
AgentDO extends DurableObject<Env>
├── 手動 SSE TransformStream
├── 手動 tool-calling loop（最多 30 rounds）
├── D1 儲存 messages、tool_calls、tool_results
├── 直接呼叫 AI Gateway（多個 provider endpoint）
├── 自訂 SSE event types（pipeline_progress, brief_update, etc.）
├── 自訂 Zod validation per tool（safeParseToolArgs）
└── 4-step brief pipeline（多模型切換）
    ├── Step 0: Gemini 2.5 Flash（case analysis, orchestrator tool-loop）
    ├── Step 1: MongoDB law fetch
    ├── Step 2: Claude Haiku 4.5（reasoning）+ Gemini native constrained decoding
    └── Step 3: Claude Sonnet 4.6 + Citations API / Gemini Flash（前言結論）
```

關鍵檔案：`AgentDO.ts`, `aiClient.ts`, `sseParser.ts`, `orchestratorAgent.ts`, `briefPipeline.ts`, `contextStore.ts`, `claudeClient.ts`, `tools/`

## 評估結果

### 1. AI Provider 整合 — 阻力最大

| 需求                                                | 現有做法                          | Agents SDK 支援                            |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| Gemini native `responseSchema` constrained decoding | `callGeminiNative()` 直打原生端點 | ❌ AI SDK 無對應 API                       |
| `cf-aig-authorization` header                       | 直接設定                          | ❌ AI SDK adapter 不支援非標準 auth header |
| `cf-aig-byok-alias` header（OpenRouter stored key） | 直接設定                          | ❌ 同上                                    |
| 同一 pipeline 混用 3+ 模型                          | 各步驟獨立呼叫                    | ⚠️ 可行但需手動繞過 `streamText`           |
| Claude Citations API                                | `claudeClient.ts` 直接呼叫        | ❌ AI SDK 無 Citations API 支援            |

AI SDK 的 model adapter 假設標準 API endpoint + 標準 auth。LexDraft 的 AI Gateway 路由方式（custom headers、native endpoint、multiple providers）完全在 adapter 的設計範圍之外。

### 2. Message Storage — 架構衝突

|                  | 現有架構                                   | Agents SDK                          |
| ---------------- | ------------------------------------------ | ----------------------------------- |
| 儲存位置         | D1（共享資料庫）                           | DO 內建 SQLite（per-instance）      |
| Schema           | 自訂 messages table + metadata JSON        | `cf_agents_state` table（SDK 管理） |
| 關聯性           | messages → cases → briefs → disputes（FK） | 獨立，無外鍵關聯                    |
| 跨 instance 查詢 | ✅ D1 共享                                 | ❌ per-DO 隔離                      |

Messages 與 cases、briefs、disputes 有 foreign key 關聯，且需要跨 DO instance 查詢（如載入歷史對話）。Agents SDK 的 per-DO SQLite 無法滿足此需求。

### 3. SSE Streaming — 格式不相容

現有自訂 SSE events：

```
message_start, text_delta, message_end,
tool_call_start, tool_result,
pipeline_progress, brief_update,
suggested_actions, error, done
```

Agents SDK 使用 AI SDK 的 `DataStreamResponse` 格式（data parts protocol），與上述完全不同。遷移需要**前後端全改**：後端 SSE 格式、前端 `useChatStore` 的 SSE parser、所有 event dispatch 邏輯。

### 4. Tool Calling Loop — 客製需求超出 SDK 範圍

現有 loop 的特殊行為，SDK 的 `maxSteps` 黑盒模式無法介入：

- Tool result 截斷至 200 chars + 歷史訊息壓縮（降低 context 成本）
- Gemini concatenated JSON splitting（`splitConcatenatedJson`）
- U+FFFD sanitization（AI Gateway UTF-8 邊界問題）
- Tool 內部發送嵌套 SSE（`pipeline_progress`, `brief_update`）
- `safeParseToolArgs()` 回傳 toolError 而非 throw（agent loop 容錯）
- Abort/cancel 支援（`AbortController` 傳播到 AI calls + tool execution）

### 5. Brief Pipeline — 完全不適用

4-step brief pipeline 是最複雜的部分：

- Orchestrator agent（sub tool-loop for file reading）
- ContextStore 跨步驟狀態管理
- 多模型切換（Gemini → Claude Haiku → Gemini constrained → Claude Sonnet）
- Citations API 整合
- Snapshot callback 機制

這不是「chat + tools」的模式。`AIChatAgent` 的 `onChatMessage` → `streamText` → `maxSteps` 抽象完全無法覆蓋此流程。

## 決策

**不採用 Cloudflare Agents SDK**。

### 理由

1. **impedance mismatch**：SDK 設計給「單模型 chat + 標準 tool calling」場景。LexDraft 是多模型 pipeline + 自訂 streaming + D1 共享資料庫，架構模式根本不同。

2. **增加不必要的抽象層**：從「直接控制 AI Gateway」變成「透過 AI SDK adapter → AI Gateway」，多了一層抽象卻喪失 constrained decoding、custom headers、Citations API 等能力。

3. **遷移成本極高**：前後端都要改（SSE 格式、message storage、tool loop、React stores），而收益（自動 message persistence、resumable streaming）可以用更小的代價自行實作。

4. **SDK 不穩定**：仍在 v0.x（截至 2026-03-09），API 持續變動，遷移到 moving target 風險高。

5. **現有 DO 用法已足夠乾淨**：`AgentDO.ts` 的 DO boilerplate 很薄（fetch handler → TransformStream → loop），複雜度在業務邏輯而非 DO 層。換 SDK 不會減少業務邏輯的複雜度。

### 可選擇性借鑑的功能

| 功能                | 價值 | 建議                                                   |
| ------------------- | ---- | ------------------------------------------------------ |
| Resumable streaming | 中   | 可自行在 DO SQLite 中 buffer chunks，遠比整合 SDK 簡單 |
| `@callable()` RPC   | 低   | 目前只有 `/chat` 和 `/cancel` 兩個 endpoint            |
| Scheduling/Cron     | 待定 | 未來如需定時任務，直接用 DO alarm API                  |
| React hooks         | 低   | 已有完整的 Zustand stores + 自訂 SSE parsing           |

## 重新評估條件

以下任一條件成立時值得重新評估：

1. Agents SDK 達到 v1.0 穩定版
2. AI SDK adapter 支援 Cloudflare AI Gateway custom headers + Gemini native endpoint
3. LexDraft 架構大幅簡化（如放棄多模型 pipeline、改用單一模型）
4. D1 message storage 有明確理由需要遷移到 DO-local SQLite

## 參考資料

- [Cloudflare Agents SDK 文檔](https://developers.cloudflare.com/agents/)
- [Agent class internals](https://developers.cloudflare.com/agents/concepts/agent-class/)
- [AIChatAgent (Chat agents)](https://developers.cloudflare.com/agents/api-reference/chat-agents/)
- [GitHub - cloudflare/agents](https://github.com/cloudflare/agents)
- [Agents SDK changelog](https://developers.cloudflare.com/changelog/product/agents/)
