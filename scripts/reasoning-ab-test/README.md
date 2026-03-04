# Reasoning Strategy A/B Test

## 目標

測試推理策略步驟（brief pipeline Step 2）使用不同模型的品質與成本差異。

**3 個模型 × 3 次執行 = 9 次完整推理策略測試**

## 模型對比

| 模型                            | API 路徑                | 格式              | Model ID                    | 成本 (in/out per 1M tokens) |
| ------------------------------- | ----------------------- | ----------------- | --------------------------- | --------------------------- |
| **Claude Haiku 4.5** (baseline) | AI Gateway → Anthropic  | Anthropic API     | `claude-haiku-4-5-20251001` | $0.80 / $4.00               |
| **DeepSeek V3.2**               | AI Gateway → OpenRouter | OpenAI-compatible | `deepseek/deepseek-chat`    | $0.25 / $0.38               |
| **Qwen 3.5 Plus**               | AI Gateway → OpenRouter | OpenAI-compatible | `qwen/qwen3.5-plus`         | $0.20 / $0.88               |

DeepSeek 和 Qwen 都透過 AI Gateway 的 OpenRouter 供應商（`lex-draft-openrouter`）路由。

## 使用方式

```bash
npx tsx scripts/reasoning-ab-test/ab-test.ts

# 只跑特定模型
npx tsx scripts/reasoning-ab-test/ab-test.ts --model claude
npx tsx scripts/reasoning-ab-test/ab-test.ts --model deepseek
npx tsx scripts/reasoning-ab-test/ab-test.ts --model qwen
```

腳本直接 import `src/server/` 的常數和工具函式（`strategyConstants.ts`、`lawConstants.ts`、`validateStrategy.ts`、`jsonUtils.ts`），確保與正式程式碼同步。

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

## 評估指標

| 指標                             | 說明                           |
| -------------------------------- | ------------------------------ |
| `total_time_ms`                  | 總耗時                         |
| `rounds`                         | 推理輪數（1-6）                |
| `search_count`                   | 法條搜尋次數                   |
| `laws_found`                     | 搜尋到的法條 ID 列表           |
| `finalize_called`                | 是否主動呼叫 finalize_strategy |
| `input_tokens` / `output_tokens` | 累計 token 用量                |
| `estimated_cost`                 | 預估成本 (USD)                 |
| `json_parse_ok`                  | JSON 能否正確解析              |
| `validation_pass`                | 結構驗證是否通過               |
| `num_claims`                     | 產出的 claims 數量             |
| `num_sections`                   | 產出的 sections 數量           |
| `issue_coverage`                 | 爭點覆蓋率（n/4）              |

## 決策結果

測試結論（詳見 `reports/reasoning-model-comparison.md`）：

- **Claude Haiku 4.5** 維持為 Step 2 Phase A（Reasoning）模型
- Step 2 Phase B（Structuring）已改用 **Gemini 2.5 Flash native** + constrained decoding
- DeepSeek 推理品質不合格（0 次 search_law），MiniMax 品質 ~90% Claude 但慢 54%
