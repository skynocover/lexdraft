# CLAUDE.md

## MongoDB + Vite + Cloudflare Workers 注意事項

### 不要用 singleton MongoClient

`src/server/lib/lawSearch.ts` 刻意使用 per-request `new MongoClient()` 並在 `finally` 中 `close()`。
不要改成 module-level singleton — Workers/miniflare 在 request 之間不維護 TCP socket，
singleton 的 pooled connection 會變成 stale，第二次請求會 hang 直到 runtime timeout。

### vite.config.ts 的 esbuild plugin

`optimizeDeps.esbuildOptions.plugins` 裡的 `fix-punycode` plugin 不能移除。
原因：mongodb 依賴鏈 `mongodb → whatwg-url → tr46 → require("punycode/")` 帶尾斜線，
esbuild 無法解析這個格式會留下 dynamic require，runtime 會炸。plugin 將 `punycode/` 指向實際路徑。

### compatibility_flags 用 nodejs_compat 不要用 nodejs_compat_v2

`@cloudflare/vite-plugin` 的 `unsafeModuleFallbackService` 只認 `nodejs_compat` flag。
用 `nodejs_compat_v2` 時 plugin 不會啟用 `node:` 模組 fallback，會報 `no match for module: node:fs`。
配合 `compatibility_date >= 2024-09-23`，`nodejs_compat` 已自動包含 v2 功能。

---

## 法規搜尋（MongoDB Atlas Search）

### 連線資訊

| 項目 | 值 |
|---|---|
| Database | `lawdb` |
| Collection | `articles` |
| Search Index | `law_search` |
| Analyzer | `lucene.smartcn` |
| 條文數 | 221,061 筆 |
| 同義詞 | 137 組（collection: `synonyms`，index mapping: `law_synonyms`） |

環境變數 `MONGO_URL` 設定 `mongodb+srv://` 連線字串。

### Document schema

| 欄位 | 說明 | Analyzer |
|---|---|---|
| `_id` | `{pcode}-{條號}` | — |
| `pcode` | 法規編號 | keyword |
| `law_name` | 法規名稱 | smartcn |
| `nature` | 法規性質（憲法/法律/命令） | keyword |
| `category` | 法規類別 | smartcn |
| `chapter` | 所屬章節 | smartcn |
| `article_no` | 條號 | keyword |
| `content` | 條文內容 | smartcn |
| `aliases` | 別名（頓號分隔） | smartcn |
| `last_update` | 最新異動日期 | — |

法規網址由 pcode 組出：`https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode={pcode}`

### 同義詞

137 組，常用如：勞基法↔勞動基準法、個資法↔個人資料保護法、刑法↔中華民國刑法、
民訴法↔民事訴訟法、刑訴法↔刑事訴訟法、道交條例↔道路交通管理處罰條例等。
搜尋簡稱會自動展開為全名。

### 搜尋精準度限制

- 法規名稱 / 別名 / 特定條號：精準度高
- 法律概念搜尋（如「不當得利要件」）：Atlas Search 是關鍵字搜尋，非語義搜尋，精準度低
- `synonyms` 只能用在 `lucene.smartcn` 分析器的欄位，不能和 `article_no`（keyword）混用
- `fuzzy` 和 `synonyms` 不能同時使用
- M0 免費方案儲存上限 512MB，目前使用 ~54MB
