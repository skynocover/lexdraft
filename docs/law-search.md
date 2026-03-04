# Law Search (MongoDB Atlas Search + Vector Search)

- **DB**: `lawdb.articles` (60,199 articles — 法律 46,839 + 命令/施行細則 13,142 + 憲法 218), index `law_search` (smartcn) + `vector_index` (512 dim, cosine)
- **Env var**: `MONGO_URL` (mongodb+srv:// connection string), `MONGO_API_KEY` (Voyage AI embedding API key)
- **Document fields**: `_id` (`{pcode}-{number}`，如 `B0000001-184`), `pcode`, `law_name`, `nature`, `category`, `chapter`, `article_no`（如 `第 184 條`）, `content`, `aliases`, `last_update`, `embedding` (512 dim)
- **Synonyms**: 172 groups in `synonyms` collection, loaded at application layer via `loadSynonymsAsAliasMap()`. Atlas Search `synonyms: "law_synonyms"` mapping 已移除（與 smartcn 不相容）
- **Law URL pattern**: `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode={pcode}`

## 搜尋策略 — Hybrid（`lawSearch.ts`）

查詢分類與策略：

1. **條號查詢**（如「民法第184條」）→ keyword 三層 fallback（不變）
   - S0: `_id` 直查 O(1)，~25ms
   - S1: regex 匹配，~1000ms+
   - S2: Atlas Search keyword，~30ms
2. **概念查詢**（法規+概念 或 純概念）→ Hybrid keyword+vector → vector-first merge：
   - 判斷 lawName + concept（opts.lawName / regex / tryExtractLawName / CONCEPT_TO_LAW 改寫表）
   - 有 apiKey → keyword + filteredVector 平行執行 → vector-first merge（vector 結果優先排序，keyword 補位）
   - 無 apiKey → keyword only（graceful fallback）
   - `law_name` 參數支援：agent/pipeline 可傳入明確法規名稱，keyword 用 pcode filter，vector 用 pre-filter
   - 實驗驗證：vector-first merge（MRR 0.536）優於 RRF（MRR 0.353），22 query benchmark

## CONCEPT_TO_LAW 改寫表（`lawConstants.ts`）

常見法律概念 → 目標法規 + 改寫詞，解決 keyword 搜尋的核心問題（如搜「損害賠償」不再回傳「核子損害賠償法」）：

| 概念       | 目標法規     | 改寫詞     |
| ---------- | ------------ | ---------- |
| 損害賠償   | 民法         | 損害賠償   |
| 精神慰撫金 | 民法         | 慰撫金     |
| 過失傷害   | 刑法         | 過失傷害   |
| 車禍賠償   | 民法         | 損害賠償   |
| 定型化契約 | 消費者保護法 | 定型化契約 |
| 解僱       | 勞動基準法   | 終止契約   |

新增概念時在 `CONCEPT_TO_LAW` 中添加即可，`tryRewriteQuery()` 會自動使用。

## 搜尋測試腳本

- `scripts/law-search-test/search-test.ts` — 回歸測試（A-E: keyword, F-I: hybrid/vector）
- 需要 `MONGO_URL` + `MONGO_API_KEY`（在 `dist/lexdraft/.dev.vars` 或環境變數）
- 無 `MONGO_API_KEY` 時 F/G 類 vector-dependent 測試自動 SKIP

修改 `lawSearch.ts` 或 `lawConstants.ts` 後務必跑測試確認。

注意：測試腳本（`.ts`）直接 import `lawConstants.ts`，修改後會自動同步。

## `PCODE_MAP` 維護（`lawConstants.ts`）

- 來源：`/Users/ericwu/Documents/mojLawSplitJSON/FalVMingLing/` 中的 JSON（全國法規資料庫），檔名即 pcode
- 目前收錄 78 部常用法規，涵蓋民刑商勞行政稅法等領域
- 新增法規時從 FalVMingLing JSON 確認正確 pcode，不要猜測

## 概念搜尋已知限制

純 keyword + smartcn 的概念搜尋對關鍵字選擇很敏感（已由 CONCEPT_TO_LAW 改寫表部分解決）：

| 能搜到          | 搜不到               | 原因                               |
| --------------- | -------------------- | ---------------------------------- |
| `民法 侵權行為` | `民法 精神慰撫金`    | 法條用「慰撫金」不用「精神慰撫金」 |
| `民法 損害賠償` | `民法 不能工作 損失` | 法條用「勞動能力」不用「不能工作」 |
| `民法 毀損`     | `民法 物之毀損`      | 「物之」干擾 tokenization          |

改寫表已涵蓋「精神慰撫金→慰撫金」「勞動能力減損→勞動能力」等常見轉換。未涵蓋的口語查詢走 vector search fallback。
