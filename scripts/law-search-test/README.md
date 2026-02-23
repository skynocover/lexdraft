# Law Search 測試腳本

測試 `src/server/lib/lawSearch.ts` 搜尋策略的正確性與效能。

## 使用方式

```bash
# 從專案根目錄執行
node scripts/law-search-test/search-test.mjs
```

需要 MongoDB Atlas 連線。腳本從 `dist/lexdraft/.dev.vars` 讀取 `MONGO_URL`。

## 測試內容

### 搜尋策略

lawSearch.ts 有 3 層 fallback：

| 策略 | 觸發條件 | 預期耗時 | 方式 |
|---|---|---|---|
| S0 _id lookup | 查詢含具體條號 + 法規在 PCODE_MAP | ~25ms | `findOne({ _id: '{pcode}-{num}' })` |
| S1 regex | 查詢含具體條號但 S0 miss | ~1000ms+ | `find({ law_name, article_no: regex })` |
| S2 Atlas Search | 概念搜尋或 S0+S1 都 miss | ~30-80ms | `$search` compound query |

### 測試分類

| 分類 | 數量 | 驗證重點 |
|---|---|---|
| A. 具體條號 | 14 | S0 命中、條號格式正確、條之X 格式 |
| B. 縮寫條號 | 6 | ALIAS_MAP 解析 → S0 命中 |
| C. 法規+概念 | 20 | pcode filter 精確到正確法規、概念匹配品質 |
| D. 純概念 | 5 | 無法規名稱時的搜尋品質 |
| E. 邊界情況 | 9 | 施行法、條之1格式、冷門法規 |

### 驗證項目

每個測試案例驗證：
1. **策略正確**：走了預期的策略（S0/S1/S2）
2. **條號正確**（條號查詢時）：返回的 article_no 與預期匹配
3. **法規正確**（概念查詢時）：返回結果的 law_name 是目標法規，不是其他法規
4. **有結果**：不是 0 筆

### 已知限制（不算失敗）

- `"民法 慰撫金"` 找不到第 195 條 — 因為條文不含「慰撫金」三個字（關鍵字搜尋的根本限制）
- `"民事訴訟法 舉證"` 第 277 條排名偏後 — 其他條文的「舉證」出現次數更多
- 純概念搜尋品質不穩定（如「損害賠償」返回核子損害賠償法）

## 新增測試案例

在 `search-test.mjs` 的 `TEST_CASES` 陣列中新增：

```javascript
{
  query: '搜尋字串',
  expect: 'S0',              // 預期策略：S0 / S1 / S2
  expectArticle: '第 184 條', // 可選：預期的條號（S0/S1 時用）
  mustContainLaw: '民法',     // 可選：結果必須包含此法規（概念搜尋時用）
  desc: '測試描述',
}
```

## 歷史基準（2025-02 優化後）

```
Total: 54 | Pass: 54 | Avg: 32ms
S0_id_lookup: 25 queries, avg 24ms
S2_atlas_law_concept: ~20 queries, avg 30-40ms
S2_atlas_pure_concept: ~5 queries, avg 30-60ms
S1_regex: 0 queries (PCODE_MAP 覆蓋率足夠，不再 fallback)
```
