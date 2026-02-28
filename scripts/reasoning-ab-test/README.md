# Reasoning Strategy A/B Test

## 目標

測試推理策略步驟（brief pipeline Step 2）使用不同模型的品質與成本差異。

**3 個模型 × 3 次執行 = 9 次完整推理策略測試**

## 模型對比

| 模型 | API 路徑 | 格式 | Model ID | 成本 (in/out per 1M tokens) |
|------|---------|------|----------|---------------------------|
| **Claude Haiku 4.5** (baseline) | AI Gateway → Anthropic | Anthropic API | `claude-haiku-4-5-20251001` | $0.80 / $4.00 |
| **DeepSeek V3.2** | AI Gateway → OpenRouter | OpenAI-compatible | `deepseek/deepseek-chat` | $0.25 / $0.38 |
| **Qwen 3.5 Plus** | AI Gateway → OpenRouter | OpenAI-compatible | `qwen/qwen3.5-plus` | $0.20 / $0.88 |

DeepSeek 和 Qwen 都透過 AI Gateway 的 OpenRouter 供應商（`lex-draft-openrouter`）路由。

## Gateway URL 構造

```
Claude:     https://gateway.ai.cloudflare.com/v1/{CF_ACCOUNT_ID}/{CF_GATEWAY_ID}/anthropic/v1/messages
OpenRouter: https://gateway.ai.cloudflare.com/v1/{CF_ACCOUNT_ID}/{CF_GATEWAY_ID}/openrouter/v1/chat/completions
```

認證：所有請求使用 `cf-aig-authorization: Bearer {CF_AIG_TOKEN}`（gateway 自動注入各供應商 API key）。

## 測試案件

車禍損害賠償案件（台灣最常見民事案件類型）：

- **原告**：騎機車遭被告闖紅燈撞擊
- **傷害**：左小腿骨折、多處擦傷、3 個月無法工作

### 4 個爭點

1. **侵權行為損害賠償責任** — §184, §191-2
2. **醫療費用及看護費用** — §193
3. **勞動能力減損** — §193
4. **精神慰撫金** — §195

預先提供 §184 和 §191-2 全文，其餘法條需模型主動 search_law 搜尋。

## 架構設計

### 腳本結構

```
ab-test.mjs
├── loadDevVars()           — 讀取 dist/lexdraft/.dev.vars
├── TEST_INPUT              — 硬編碼車禍案件
├── SYSTEM_PROMPT           — 從 codebase 複製（與正式環境完全一致）
├── TOOL_DEFS               — search_law + finalize_strategy (Claude + OpenAI 雙格式)
│
├── callClaudeToolLoop()    — Anthropic API tool-loop (Phase 1)
├── callOpenAIToolLoop()    — OpenAI-compatible tool-loop (Phase 1, DeepSeek/Qwen 共用)
├── callClaudeJson()        — Claude JSON 輸出 (Phase 2)
├── callOpenAIJson()        — OpenAI-compatible JSON 輸出 (Phase 2)
│
├── handleSearchLaw()       — MongoDB Atlas 真實法條搜尋
├── parseAndValidate()      — JSON 解析 + 結構驗證
│
├── runSingleTest()         — 單次完整測試 (Phase 1 + Phase 2)
└── main()                  — 3 模型 × 3 次 + 報告
```

### Tool Format 轉換

Claude 和 OpenAI 的 tool calling 格式不同，腳本自動轉換：

```
Tool Definitions:
  Claude:  { name, description, input_schema }
  OpenAI:  { type: 'function', function: { name, description, parameters } }

Assistant Tool Calls:
  Claude:  content: [{ type: 'tool_use', id, name, input: {...} }]
  OpenAI:  tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }]

Tool Results:
  Claude:  { role: 'user', content: [{ type: 'tool_result', tool_use_id, content }] }
  OpenAI:  { role: 'tool', tool_call_id, content }
```

### 執行流程（每次測試）

**Phase 1: Tool-Loop 推理**（max 6 rounds, max 6 searches）

```
User Message (案件摘要 + 爭點 + 法條 + 檔案摘要)
  ↓
Model → 推理文字 + search_law("民法 損害賠償")
  ↓
MongoDB 真實搜尋 → 回傳法條全文
  ↓
Model → 推理文字 + search_law("民法 慰撫金")
  ↓
MongoDB 搜尋 → 回傳
  ↓
Model → finalize_strategy(reasoning_summary, per_issue_analysis)
  ↓
結束
```

**Phase 2: JSON 結構化輸出**

```
reasoning_summary + per_issue_analysis + 法條列表 + 檔案列表
  ↓
Model → 完整 JSON (claims + sections)
  ↓
解析 + 驗證 → 失敗則 retry 一次
```

## 評估指標

| 指標 | 說明 |
|------|------|
| `total_time_ms` | 總耗時 |
| `rounds` | 推理輪數（1-6） |
| `search_count` | 法條搜尋次數 |
| `laws_found` | 搜尋到的法條 ID 列表 |
| `finalize_called` | 是否主動呼叫 finalize_strategy |
| `input_tokens` / `output_tokens` | 累計 token 用量 |
| `estimated_cost` | 預估成本 (USD) |
| `json_parse_ok` | JSON 能否正確解析 |
| `validation_pass` | 結構驗證是否通過 |
| `validation_errors` | 驗證錯誤列表 |
| `num_claims` | 產出的 claims 數量 |
| `num_sections` | 產出的 sections 數量 |
| `issue_coverage` | 爭點覆蓋率（n/4） |

## 預期輸出

```
══════════════════════════════════════════════════════════
  Reasoning Strategy A/B Test — 3 models × 3 runs
══════════════════════════════════════════════════════════

▶ Claude Haiku 4.5 (claude-haiku-4-5-20251001)
  Run 1: ✅ 12.3s | 4 rounds, 3 searches | parse ✅ valid ✅ | 5 claims 6 sections | $0.098
  Run 2: ✅ 10.8s | 3 rounds, 2 searches | parse ✅ valid ✅ | 5 claims 6 sections | $0.089
  Run 3: ✅ 11.5s | 3 rounds, 3 searches | parse ✅ valid ✅ | 5 claims 6 sections | $0.093

▶ DeepSeek V3.2 (deepseek/deepseek-chat via OpenRouter)
  Run 1: ✅  7.5s | 3 rounds, 2 searches | parse ✅ valid ✅ | 4 claims 5 sections | $0.011
  Run 2: ✅  8.1s | 4 rounds, 3 searches | parse ✅ valid ❌ | 5 claims 6 sections | $0.013
  Run 3: ✅  6.9s | 3 rounds, 2 searches | parse ✅ valid ✅ | 4 claims 5 sections | $0.010

▶ Qwen 3.5 Plus (qwen/qwen3.5-plus via OpenRouter)
  Run 1: ✅  9.2s | 3 rounds, 3 searches | parse ✅ valid ✅ | 5 claims 6 sections | $0.015
  Run 2: ✅  8.8s | 3 rounds, 2 searches | parse ✅ valid ✅ | 5 claims 6 sections | $0.014
  Run 3: ✅  9.5s | 4 rounds, 3 searches | parse ✅ valid ✅ | 5 claims 6 sections | $0.016

══════════════════════════════════════════════════════════
  SUMMARY
══════════════════════════════════════════════════════════
Model              Avg Time  Avg Cost  Parse  Valid  Claims  Sections  Coverage
Claude Haiku 4.5    11.5s    $0.093     3/3    3/3    5.0     6.0      4/4
DeepSeek V3.2        7.5s    $0.011     3/3    2/3    4.3     5.3      4/4
Qwen 3.5 Plus        9.2s    $0.015     3/3    3/3    5.0     6.0      4/4
```

## 使用方式

```bash
node scripts/reasoning-ab-test/ab-test.mjs
```

### 環境需求

從 `dist/lexdraft/.dev.vars` 自動讀取：

```
CF_ACCOUNT_ID=...
CF_GATEWAY_ID=...
CF_AIG_TOKEN=...
MONGO_URL=mongodb+srv://...
MONGO_API_KEY=...
```

不需要 dev server 運行。MongoDB 為真實連線（法條搜尋走 Atlas Search + Vector Search）。

### 只跑特定模型

```bash
# 只跑 Claude
node scripts/reasoning-ab-test/ab-test.mjs --model claude

# 只跑 DeepSeek
node scripts/reasoning-ab-test/ab-test.mjs --model deepseek

# 只跑 Qwen
node scripts/reasoning-ab-test/ab-test.mjs --model qwen
```

## 從 Codebase 複製的內容

| 來源檔案 | 複製內容 | 確保一致性 |
|---------|---------|-----------|
| `src/server/agent/prompts/reasoningStrategyPrompt.ts` | System prompt + user message builder | 同一 prompt |
| `src/server/agent/prompts/strategyConstants.ts` | CLAIMS_RULES, SECTION_RULES, JSON_SCHEMA | 同一規則 |
| `src/server/agent/pipeline/validateStrategy.ts` | 驗證邏輯 | 同一標準 |
| `src/server/agent/toolHelpers.ts` | JSON 解析工具 | 同一解析 |
| `scripts/law-search-test/strategy-compare.mjs` | MongoDB + 搜尋函式 | 同一搜尋 |

## 風險與 Fallback

| 風險 | 處理方式 |
|------|---------|
| OpenRouter 金鑰失效 | 第一次 API call 偵測 401/403，提示並跳過 |
| 模型不支援 tool calling | 捕捉錯誤，標記 FAIL，繼續下一 run |
| JSON 解析失敗 | 記錄 raw output 前 500 字供人工檢視 |
| MongoDB 連線失敗 | 5 秒超時，與現有測試腳本一致 |
| 模型在 OpenRouter 上的 model ID 不同 | 腳本頂部可快速修改 MODEL_ID |

## 決策依據

測試結果將用於決定：

1. **推理策略** 是否可從 Claude Haiku 切換到更便宜的模型
2. 如果切換，選 DeepSeek 還是 Qwen
3. 是否需要「拆分策略」（用便宜模型做 tool-loop + Claude 做 JSON 輸出）
4. 品質下降是否可接受，還是需要額外的 retry/validation 補償
