# LexDraft 正式區部署指南

## 前置條件

- Cloudflare Workers **Paid plan**（$5/月），因為需要 Queue + Durable Objects
- Node.js 18+、npm、全域安裝 `wrangler`（或用 `npx wrangler`）
- 已登入 Cloudflare：`wrangler login`

## 1. 建立 Cloudflare 資源

### 1.1 D1 Database

```bash
wrangler d1 create lexdraft-db
```

建立後會回傳 `database_id`，將它填入 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "lexdraft-db",
    "database_id": "<填入真正的 database_id>",
    "migrations_dir": "./drizzle"
  }
]
```

### 1.2 R2 Bucket

```bash
wrangler r2 bucket create lexdraft-files
```

### 1.3 Queue

```bash
wrangler queues create lexdraft-file-processing
```

Queue 用於非同步 PDF 檔案處理（上傳 → 解析 → AI 摘要 → 寫回 DB）。`wrangler.jsonc` 已定義 producer/consumer 綁定，deploy 時自動生效。

### 1.4 Durable Objects

不需手動建立。`wrangler deploy` 會根據 `wrangler.jsonc` 的 `durable_objects` + `migrations` 自動建立 `AgentDO`。

## 2. 設定 AI Gateway

1. 前往 Cloudflare Dashboard → AI → AI Gateway
2. 建立一個新的 Gateway，記下 **Gateway ID**
3. 設定三個 Provider：

| Provider | 用途 | 備註 |
|----------|------|------|
| **Google AI Studio** | Chatbot、Step 0、前言/結論、檔案處理 | Gateway 內建支援 |
| **Anthropic** | Claude Citations API（書狀寫作） | Gateway 內建支援 |
| **OpenRouter** | Gemini 3.1 Flash Lite 等模型 | 需設定 Stored API Key |

### OpenRouter BYOK 設定（重要）

OpenRouter 透過 AI Gateway 的 **Stored API Keys (BYOK)** 機制認證：

1. AI Gateway → Settings → API Keys
2. 新增一組 key，**alias 必須設為 `lex-draft-openrouter`**（程式碼硬編碼於 `aiClient.ts`）
3. 填入 OpenRouter 的 API Key

程式會在 request header 帶 `cf-aig-byok-alias: lex-draft-openrouter`，Gateway 據此找到對應的 stored key。**如果 alias 不對或沒設定，會得到 401 錯誤。**

### Anthropic BYOK 設定

同上方式新增 Anthropic API Key 的 stored key。alias 名稱需與程式碼對應（目前 Anthropic 使用 `cf-aig-authorization` header 直接帶 token，不需 byok-alias）。

## 3. 設定 Secrets

所有敏感值透過 `wrangler secret put` 設定，不要寫在 `wrangler.jsonc`：

```bash
# 正式環境認證 token（前端登入用）
wrangler secret put AUTH_TOKEN

# Cloudflare Account ID（Dashboard 右側欄可找到）
wrangler secret put CF_ACCOUNT_ID

# AI Gateway ID（步驟 2 建立的 Gateway ID）
wrangler secret put CF_GATEWAY_ID

# AI Gateway 認證 token（AI Gateway → Settings → API Token）
wrangler secret put CF_AIG_TOKEN

# MongoDB Atlas 完整連線字串（法條搜尋用）
wrangler secret put MONGO_URL

# Voyage AI embedding API Key（法條 vector search 用）
wrangler secret put MONGO_API_KEY
```

每個指令會互動式提示輸入值。

### Secrets 對照表

| Secret | 來源 | 用途 |
|--------|------|------|
| `AUTH_TOKEN` | 自行設定 | Bearer token 認證 |
| `CF_ACCOUNT_ID` | Cloudflare Dashboard → 右側欄 | AI Gateway URL 組成 |
| `CF_GATEWAY_ID` | AI Gateway 建立後取得 | AI Gateway URL 組成 |
| `CF_AIG_TOKEN` | AI Gateway → Settings | 所有 AI 呼叫的認證 |
| `MONGO_URL` | MongoDB Atlas → Connect | 法條資料庫連線 |
| `MONGO_API_KEY` | Voyage AI | Embedding API（vector search） |

## 4. 執行 Database Migration

```bash
wrangler d1 migrations apply lexdraft-db --remote
```

這會將 `./drizzle/` 下的所有 migration 套用到正式區 D1。

## 5. 部署

```bash
npm run build
npm run deploy   # 即 wrangler deploy
```

## 6. 驗證

部署後檢查以下項目：

1. **網站可存取**：瀏覽 Worker URL，確認 SPA 正常載入
2. **API 認證**：`curl -H "Authorization: Bearer <AUTH_TOKEN>" https://<worker>/api/cases` 應回傳 JSON
3. **檔案上傳 + Queue**：上傳一個 PDF，確認幾秒後狀態變為 `ready`（Queue 正常運作）
4. **聊天功能**：發送訊息，確認 SSE streaming 和 AI 回應正常
5. **法條搜尋**：觸發 `search_law` tool，確認 MongoDB 連線正常

## 7. 常見問題

### Queue 訊息卡住

```bash
# 查看 Queue 狀態
wrangler queues list
```

Queue 設定 `max_retries: 3`，失敗 3 次後訊息會被丟棄。檢查 Worker logs 找 `Queue processing error`。

### AI Gateway 401 錯誤

- Google AI Studio：確認 `CF_AIG_TOKEN` 正確
- OpenRouter：確認 AI Gateway 有設定 alias 為 `lex-draft-openrouter` 的 stored key
- Anthropic：確認 AI Gateway 有設定 Anthropic provider 的 API key

### D1 migration 失敗

```bash
# 查看已套用的 migrations
wrangler d1 migrations list lexdraft-db --remote
```

### Durable Object 錯誤

首次部署時 DO migration 會自動執行。如果升級 DO schema，需要在 `wrangler.jsonc` 的 `migrations` 加新的 tag。

## 資源架構總覽

```
Cloudflare Workers (lexdraft)
├── D1 Database (lexdraft-db)        ← 主資料庫
├── R2 Bucket (lexdraft-files)       ← PDF 檔案儲存
├── Queue (lexdraft-file-processing) ← 非同步檔案處理
├── Durable Object (AgentDO)         ← Agent 聊天 loop
└── AI Gateway
    ├── Google AI Studio             ← Gemini 2.5 Flash
    ├── Anthropic                    ← Claude Sonnet 4.6
    └── OpenRouter (BYOK)           ← Gemini 3.1 Flash Lite 等
```

## 費用預估

| 資源 | 免費額度 | 超過後計費 |
|------|---------|-----------|
| Workers | 10M requests/月 | $0.30/M requests |
| D1 | 5M rows read, 100K writes/天 | $0.001/M rows read |
| R2 | 10M Class A, 10M Class B/月 | $0.36/M Class A |
| Queue | 1M operations/月 | $0.40/M operations |
| Durable Objects | 含在 Paid plan | $0.15/M requests |
| AI Gateway | 無限制（proxy） | 免費 |

> 以上費用不含第三方 AI API 費用（Google AI Studio、Anthropic、OpenRouter）。
