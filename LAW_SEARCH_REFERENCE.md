# 台灣法規資料庫 — 搜尋系統完整參考

## 1. 連線資訊

| 項目 | 值 |
|------|---|
| MongoDB URL | `mongodb+srv://<user>:<pass>@cluster0.zifww5d.mongodb.net` |
| Database | `lawdb` |
| Collection | `articles`（60,199 筆條文） |
| Synonyms Collection | `synonyms`（172 組別名，由程式碼載入） |
| Vector Search Index | `vector_index`（512 維，cosine similarity） |
| Atlas Search Index | `law_search`（lucene.smartcn 中文分析器） |

### 環境變數

```
MONGO_URL=mongodb+srv://<user>:<pass>@cluster0.zifww5d.mongodb.net
MONGO_API_KEY=<Voyage AI API Key>
```

- `MONGO_URL`：MongoDB Atlas 連線字串
- `MONGO_API_KEY`：Voyage AI embedding API key（Atlas UI → AI Models → Model API Keys 取得）

---

## 2. Document 結構

每筆 document 代表一條法規條文：

```json
{
  "_id": "B0000001-184",
  "pcode": "B0000001",
  "law_name": "民法",
  "nature": "法律",
  "category": "行政＞法務部＞法律事務目",
  "chapter": "第 二 編 債 第 一 章 通則 第 五 節 侵權行為",
  "article_no": "第 184 條",
  "content": "因故意或過失，不法侵害他人之權利者...",
  "aliases": "",
  "last_update": "20210120",
  "embedding": [0.012, -0.034, ...]
}
```

| 欄位 | 說明 | 搜尋用途 |
|------|------|---------|
| `_id` | `{pcode}-{條號數字}` | — |
| `pcode` | 法規編號 | keyword 篩選 |
| `law_name` | 法規名稱 | smartcn 全文搜尋 |
| `nature` | 法規性質（憲法/法律/命令） | keyword 篩選 |
| `category` | 法規類別 | smartcn 全文搜尋 |
| `chapter` | 所屬章節 | smartcn 全文搜尋 |
| `article_no` | 條號（如 `第 184 條`） | keyword 精確搜尋 |
| `content` | 條文內容 | smartcn 全文搜尋 |
| `aliases` | 別名（頓號分隔） | smartcn 全文搜尋 |
| `last_update` | 最新異動日期 | — |
| `embedding` | 512 維向量（voyage-3.5） | vector 語意搜尋 |

法規網址可由 pcode 組出：`https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode={pcode}`

---

## 3. 搜尋策略（J — rewrite → keyword, vector fallback）

### 自動判斷流程

```
使用者查詢
  ├─ 條號查詢（民法第184條）
  │   ├─ S0: _id 直查 O(1)
  │   ├─ S1: regex 匹配
  │   └─ S2: Atlas Search keyword
  ├─ 法規+概念（民法 損害賠償）→ keyword Atlas Search
  └─ 純概念（損害賠償、車禍賠償）→ J 策略：
      1. 查 CONCEPT_TO_LAW 改寫表
      2. 有匹配 → keyword search → 直接回傳
         └─ keyword 無結果 → vector fallback → keyword pure concept fallback
      3. 無匹配 → vector search → keyword pure concept fallback
```

| 查詢類型 | 搜尋方式 | 說明 |
|---------|---------|------|
| 精確條號（民法 第 184 條） | S0/S1/S2 keyword | 法規名稱 + 條號精確匹配 |
| 法規+概念（民法 損害賠償） | keyword Atlas Search | 法規篩選 + 概念全文搜尋 |
| 純概念（損害賠償） | J 策略 | 改寫表 → keyword 直接回傳，vector fallback |
| 口語（車禍可以求償嗎） | vector search | 語意相似度比對 |

### CONCEPT_TO_LAW 改寫表

定義在 `lawConstants.ts`，約 50 組常見法律概念 → 目標法規映射：

| 概念 | 目標法規 | 改寫詞 |
|------|---------|--------|
| 損害賠償 | 民法 | 損害賠償 |
| 精神慰撫金 | 民法 | 慰撫金 |
| 過失傷害 | 刑法 | 過失傷害 |
| 車禍賠償 | 民法 | 損害賠償 |
| 定型化契約 | 消費者保護法 | 定型化契約 |
| 解僱 | 勞動基準法 | 終止契約 |

改寫表解決了 keyword 搜尋的核心問題：搜「損害賠償」不再回傳「核子損害賠償法」，而是精準定位到民法。改寫表命中時直接回傳 keyword 結果（不跑 vector），確保精準度且降低延遲。

---

## 4. 語意搜尋（$vectorSearch）

用於口語、概念性查詢。需先將 query 轉成 embedding 向量。

### 步驟一：將 query 轉成向量

```javascript
async function embedQuery(text, apiKey) {
  const res = await fetch('https://ai.mongodb.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-3.5',
      input: [text],
      input_type: 'query',      // 查詢必須用 query，不是 document
      output_dimension: 512,
    }),
  })
  const json = await res.json()
  return json.data[0].embedding
}
```

### 步驟二：向量搜尋

```javascript
const queryVector = await embedQuery("車禍受傷可以求償嗎", API_KEY)

const results = await coll.aggregate([
  {
    $vectorSearch: {
      index: "vector_index",
      path: "embedding",
      queryVector,
      numCandidates: 100,   // 候選數量，建議 limit 的 10 倍
      limit: 10,
    }
  },
  {
    $project: {
      _id: 1, pcode: 1, law_name: 1, nature: 1, category: 1,
      chapter: 1, article_no: 1, content: 1, aliases: 1, last_update: 1,
      url: { $concat: ["https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=", "$pcode"] },
      score: { $meta: "vectorSearchScore" },
    }
  }
]).toArray()
```

### 實測結果

| 查詢 | Top 1 結果 | Score |
|------|-----------|-------|
| 車禍受傷可以跟對方求償嗎 | 強制汽車責任保險法 第 7 條 | 0.82 |
| 房東不退押金怎麼辦 | 民法 第 472 條 | 0.79 |
| 員工被公司無預警解僱 | 勞動基準法 第 11 條 | 0.81 |
| 網路上被人罵可以告嗎 | 中華民國刑法 第 309 條 | 0.80 |
| 離婚後小孩監護權歸誰 | 民法 第 1055 條 | 0.85 |

---

## 5. 關鍵字搜尋（$search）

用於精確查詢法規名稱、條號、關鍵字。

### 一般搜尋

```javascript
const results = await coll.aggregate([
  {
    $search: {
      index: "law_search",
      compound: {
        should: [
          {
            text: {
              query: "勞動基準法",
              path: ["law_name", "aliases"],
              score: { boost: { value: 5 } }
            }
          },
          {
            text: {
              query: "勞動基準法",
              path: "content"
            }
          },
          {
            text: {
              query: "勞動基準法",
              path: ["category", "chapter"],
              score: { boost: { value: 0.5 } }
            }
          }
        ],
        minimumShouldMatch: 1
      }
    }
  },
  { $limit: 10 },
  {
    $project: {
      _id: 1, pcode: 1, law_name: 1, article_no: 1, content: 1,
      nature: 1, category: 1, chapter: 1, last_update: 1,
      score: { $meta: "searchScore" }
    }
  }
]).toArray()
```

### 特定條號搜尋

搜「民法 第 184 條」時，拆成法規名稱 + 條號：

```javascript
compound: {
  filter: [
    { text: { query: "B0000001", path: "pcode" } }
  ],
  should: [
    { phrase: { query: "第 184 條", path: "article_no" } }
  ]
}
```

### 篩選條件

```javascript
// 只搜法律（排除命令）
compound: {
  should: [ /* 同上 */ ],
  minimumShouldMatch: 1,
  filter: [
    { text: { query: "法律", path: "nature" } }
  ]
}

// 按 pcode 篩選特定法規
filter: [
  { text: { query: "B0000001", path: "pcode" } }
]
```

`nature` 可能的值：`憲法`、`法律`、`命令`（命令僅含施行細則與裁罰/裁量基準）

---

## 6. Cloudflare Workers 整合

搜尋邏輯統一在 `src/server/lib/lawSearch.ts`，提供三個 API：

```typescript
// 一次性搜尋（per-request MongoClient）
searchLaw(mongoUrl, { query, limit?, nature?, apiKey? })

// 一次性批量查找
batchLookupLawsByIds(mongoUrl, ids)

// 可重用 session（pipeline 內多次查詢用）
createLawSearchSession(mongoUrl, apiKey?)
```

環境變數透過 `MONGO_URL` 和 `MONGO_API_KEY` 傳入。

---

## 7. API 使用範例

### 語意搜尋（口語查詢，自動使用 vector）

```
POST /api/law/search  { "query": "車禍受傷可以求償嗎" }
POST /api/law/search  { "query": "房東不退押金怎麼辦" }
```

### 條號搜尋（自動使用 keyword）

```
POST /api/law/search  { "query": "民法第184條" }
POST /api/law/search  { "query": "刑法第284條" }
```

### 概念搜尋（J 策略自動路由）

```
POST /api/law/search  { "query": "損害賠償" }       → 改寫為 民法+損害賠償 → keyword 直接回傳
POST /api/law/search  { "query": "精神慰撫金" }     → 改寫為 民法+慰撫金 → keyword 直接回傳
POST /api/law/search  { "query": "過失傷害" }       → 改寫為 刑法+過失傷害 → keyword 直接回傳
POST /api/law/search  { "query": "鄰居漏水不處理" } → 無改寫匹配 → vector fallback
```

---

## 8. PCode 分類與常用法規

### 字首分類

| 字首 | 分類 | 常見法規 |
|------|------|---------|
| A | 憲法、院組織法 | A0000001 中華民國憲法 |
| B | 民事法 | B0000001 民法 |
| C | 刑事法 | C0000001 中華民國刑法 |
| D | 內政 | D0050001 兒童及少年福利與權益保障法 |
| F | 國防、兵役 | F0120002 兵役法 |
| G | 財政、金融、稅務 | G0340004 所得稅法 |
| H | 教育、文化 | H0020001 教育基本法 |
| I | 司法行政、法務 | I0050021 個人資料保護法 |
| J | 經濟、商業 | J0150002 公平交易法 |
| K | 交通 | K0040012 道路交通管理處罰條例 |
| L | 衛生、醫藥 | L0060001 全民健康保險法 |
| M | 農業 | M0060027 動物保護法 |
| N | 勞動 | N0030001 勞動基準法 |
| O | 環保 | O0020001 空氣污染防制法 |
| P | 傳播 | P0040005 電信管理法 |
| Q | 兩岸 | Q0010001 臺灣地區與大陸地區人民關係條例 |
| S | 銓敘、公務員 | S0070001 公教人員保險法 |

### 高頻法規速查

| 簡稱 | PCode | 全名 |
|------|-------|------|
| 民法 | B0000001 | 民法 |
| 刑法 | C0000001 | 中華民國刑法 |
| 憲法 | A0000001 | 中華民國憲法 |
| 民訴法 | B0010001 | 民事訴訟法 |
| 刑訴法 | C0010001 | 刑事訴訟法 |
| 行政程序法 | I0010001 | 行政程序法 |
| 公司法 | J0080001 | 公司法 |
| 勞基法 | N0030001 | 勞動基準法 |
| 消保法 | J0170001 | 消費者保護法 |
| 個資法 | I0050021 | 個人資料保護法 |
| 國賠法 | I0020004 | 國家賠償法 |
| 強執法 | B0010004 | 強制執行法 |
| 土地法 | D0060001 | 土地法 |
| 所得稅法 | G0340004 | 所得稅法 |
| 健保法 | L0060001 | 全民健康保險法 |
| 家暴法 | D0050071 | 家庭暴力防治法 |
| 性平法 | N0030014 | 性別平等工作法 |

---

## 9. 條號格式規則

JSON 中的條號格式為 `第 {數字} 條`，**數字前後各有一個半形空格**。

| 使用者可能輸入 | JSON 實際格式 | 說明 |
|--------------|-------------|------|
| 第213條 | `第 213 條` | 數字前後有空格 |
| 第15-1條 | `第 15-1 條` | 之條用 `-` 表示 |
| 213 | `第 213 條` | 需補上「第」和「條」 |
| §213 | `第 213 條` | 學術符號需轉換 |

正則：`第 \d+(-\d+)? 條`

---

## 10. 同義詞（Application Layer）

DB 的 `lawdb.synonyms` collection 儲存 172 組別名對照。Atlas Search 的 `synonyms: "law_synonyms"` mapping 因 `lucene.smartcn` 分析器不相容已移除。

同義詞現在由程式碼在連線時載入（`loadSynonymsAsAliasMap()`），轉為 `Record<string, string>` 格式，擴充 `resolveAlias()` 的能力。

三層別名來源（優先序）：
1. `ALIAS_MAP`（lawConstants.ts 硬編碼，~40 組常用縮寫）
2. DB synonyms（172 組，涵蓋更多冷門法規）
3. `CONCEPT_TO_LAW`（概念改寫，~50 組）

---

## 11. 本地 JSON 檔案（備用）

當需要讀取完整法規、章節結構或英文版時，使用本地檔案：

| 檔案 | 說明 |
|------|------|
| `FalVMingLing/{PCode}.json` | 中文法規（約 1,790 部，已過濾僅含憲法＋法律＋重要命令） |
| `Eng_FalVMingLing/{PCode}.json` | 英譯法規（約 3,145 部） |
| `index.json` | 法規索引（PCode、name、lastUpdate） |
| `aliases.json` | 常用簡稱對照（`{ "PCode": ["別名1", "別名2"] }`） |

### 單一法規 JSON 結構

```json
{
  "法規性質": "法律",
  "法規名稱": "民法",
  "法規網址": "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001",
  "最新異動日期": "20210120",
  "生效日期": "99991231",
  "是否英譯註記": "Y",
  "英文法規名稱": "Civil Code",
  "法規內容": [
    { "編章節": "第 一 編 總則" },
    { "編章節": "第 一 章 法例" },
    { "條號": "第 1 條", "條文內容": "民事，法律所未規定者，依習慣；無習慣者，依法理。" }
  ]
}
```

### 編章節層級

```
編 → 章 → 節 → 款 → 目
```

編章節標題穿插在條文陣列中。要判斷某條文屬於哪個編章節，需往前回溯找到最近的各層級標題。小型法規可能無編章節劃分。

### 條文內容格式

- 各「項」以 `\r\n` 分隔，無標號（第一段=第一項，第二段=第二項）
- 「款」以中文數字標記（一、二、三...）
- 顯示 `（刪除）` 表示已被立法院刪除但保留條號
- `生效日期` 為 `99991231` 表示持續有效

---

## 12. Embedding 技術細節

| 項目 | 值 |
|------|---|
| Model | Voyage AI `voyage-3.5` |
| 維度 | 512（Matryoshka learning 截短） |
| Endpoint | `https://ai.mongodb.com/v1/embeddings` |
| 文件 embedding input_type | `document` |
| 查詢 embedding input_type | `query` |
| Similarity | cosine |

---

## 13. 常見查詢意圖對照

| 使用者說法 | 搜尋方式 | 說明 |
|-----------|---------|------|
| 民法第184條 | S0 _id 直查 | 最快，~25ms |
| 民法 損害賠償 | keyword Atlas Search | 法規+概念 |
| 損害賠償 | J → 民法+損害賠償 keyword | 改寫表命中，直接回傳 |
| 精神慰撫金 | J → 民法+慰撫金 keyword | 改寫+概念轉換，直接回傳 |
| 車禍可以求償嗎 | J → vector fallback | 無改寫匹配，vector 搜尋 |
| 離婚小孩歸誰 | vector search | 語意搜尋 |
| 個資法罰則 | keyword | 法規名+概念 |

---

## 14. 注意事項

- **不要回傳 embedding**：`$project` 中不要包含 `embedding` 欄位
- **input_type 區分**：query embedding 用 `query`，document embedding 用 `document`，兩者向量空間不同
- **M0 限制**：儲存上限 512MB（目前約 434MB），最多 3 個 search index（目前 2 個）
- **資料範圍**：僅含法規正文，不含立法理由、司法解釋（大法官釋字）、判例、函釋
- **資料時效**：更新日期見 `UpdateDate.txt`，非即時同步法規資料庫
- **synonyms**：Atlas Search 的 `synonyms: "law_synonyms"` 已移除，改由程式碼從 DB 載入
