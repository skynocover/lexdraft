# 書狀撰寫系統 Pipeline v3 — 架構設計規劃書

## 1. 設計理念與核心原則

### 1.1 專案目標

建構基於 LLM 的書狀自動撰寫系統。接收使用者提供的案件素材，自動完成事實整理、法律研究、論證結構設計、書狀撰寫及品質審查，產出專業水準的法律書狀。

### 1.2 Vibe Coding 模式

系統採用高度自動化的運作方式：觸發後一路跑到底，產出完整書狀，中途不打斷使用者。使用者拿到書狀後再回饋修改。不設 human-in-the-loop checkpoint 阻擋 pipeline 流程。

**與「資訊不足不腦補」的協調**：Pipeline 本身保持「有什麼材料就用什麼材料」原則，遇到資訊不足時標記 `information_gaps` 但繼續執行。追問補充的責任交給對話層（AgentDO），在書狀產出後告知使用者需要補充什麼。（詳見[第 10 節](#10-資訊不足處理機制)）

### 1.3 Context Engineering 核心理念

> Context Engineering 不是在設計 agent 之間怎麼傳話，而是在設計每一次 LLM 呼叫的瞬間，context window 裡的每個 token 是否都在為輸出品質工作。Context engineering 做得好，agent 的需求就會減少。

五個維度：

| 維度 | 說明 | 在本系統的應用 |
|------|------|----------------|
| Selection 選擇 | 哪些資訊該進 context | 每段書狀只注入與該段相關的法條、事實 |
| Ordering 排列 | 資訊的先後順序 | System prompt 前段放角色定義，後段放格式規範 |
| Compression 壓縮 | 長文件的處理策略 | 已完成段落直接傳全文，不做漸進壓縮 |
| Timing 時機 | 預先準備還是即時檢索 | 法條搜尋平行執行 |
| Write/Read 分離 | 產出與消費 context 分離 | 上游產出結構化 JSON，下游按需查詢 |

### 1.4 Pipeline + Agent 混合架構

判斷標準：只有在「需要自主決策迴圈」的環節才使用 Agent，其餘全部使用 Pipeline Step。

| Pipeline Step（單次 LLM Call） | Agent（自主決策迴圈） |
|-------------------------------|---------------------|
| 輸入 → LLM → 輸出 → 下一步 | 輸入 → LLM → 判斷 → 可能呼叫工具 → 再判斷 → ... → 輸出 |
| 確定性流程，跑一次就結束 | 有自主決策迴圈，自己決定何時「做完了」 |
| 更快、更便宜、更可預測 | 更貴、更慢、但能處理不確定性任務 |

---

## 2. 現狀分析與問題診斷

### 2.1 目前的 Pipeline 流程

```
Step 1: 載入資料（純程式）
  └─ 讀取所有檔案 summary + 爭點 + 金額 + 檔案全文

Step 2: Planner（Claude，單次呼叫）
  └─ input:  檔案摘要 + 爭點 + 金額 + 書狀類型
  └─ output: BriefPlan JSON（每段的 section/instruction/relevant_file_ids/search_queries）

Step 3: 法條搜尋（純 MongoDB，無 AI）
  └─ 執行 Planner 給的 search_queries，查不到就是空的

Step 4: Writer（Claude Citations，逐段呼叫）
  └─ input:  相關檔案全文（截取 20000 字）+ 法條 + 爭點 + 前段內容
  └─ output: 段落文字 + 引用標記
```

### 2.2 現狀的問題

| 問題 | 說明 | 影響 |
|------|------|------|
| Planner 沒有素材就設計論證 | Planner 只看到摘要，手邊沒有法條也沒有結構化事實，就要決定怎麼論述 | 論證結構可能不合理 |
| 法條搜尋查不到就放棄 | 程式查一次 MongoDB，0 結果就空手，沒有重試或換關鍵字的機制 | Writer 拿到空的法條列表，段落缺乏法律根據 |
| 沒有攻防分析 | 沒有人思考「對方會用什麼法條反駁」 | 書狀只有進攻沒有防守，律師需要大量手動補充 |
| Writer 不知道全局結構 | Writer 只看到前一段文字，不知道整份書狀的架構和其他段落在寫什麼 | 可能重複論點、論述不連貫 |
| 沒有品質審核 | 寫完就結束，沒有從整份書狀角度檢查品質 | 可能有遺漏、矛盾、引用缺失 |
| 不是真正的 Sub-Agent | 每一步都是「單次 AI 呼叫」，沒有自主判斷和重試能力 | 搜尋品質取決於 Planner 給的 query 好不好 |
| 不區分事實爭議狀態 | 所有事實同等對待，不區分爭執/承認/自認 | 書狀用語不精準，論證力道不足 |

### 2.3 現有 AI 分工

| AI | 用途 | 模型 |
|----|------|------|
| Gemini 2.5 Flash | AgentDO 主迴圈（對話理解 + tool calling）、爭點分析、金額計算、時間軸、建議按鈕 | via CF AI Gateway |
| Claude | Planner（大綱規劃）、Writer（書狀撰寫 + Citations API）、單段修改 | via claudeClient.ts |

---

## 3. 系統架構總覽

### 3.1 元件清單與分類

| 元件 | 類型 | 原因 | 是否需要 LLM |
|------|------|------|-------------|
| Orchestrator | Pipeline Step | 單次 LLM call，整合事實 + 爭議分類 | 是 |
| 法律研究 | Agent | 有搜尋迴圈，不知道要查幾次 | 是 + 工具呼叫 |
| 論證策略 | Pipeline Step | 單次 LLM call，拿到完整素材後提取 claims + 設計策略 | 是 |
| 逐段撰寫 | Pipeline Loop | 每段是確定性 LLM call，多段迴圈 | 是 |
| 品質審查 | Pipeline Step + 程式前檢 | 程式先做結構化檢查，再用 LLM 做語意審查（僅回報，不自動修正） | 部分是 |

> **模板系統**暫不實作。書狀骨架由論證策略 Step 根據書狀類型和案件內容動態決定。待累積足夠產出後，再從中歸納模板。

### 3.2 架構流程圖

```
使用者觸發撰寫書狀
         │
         ▼
┌─────────────────────────────────────────┐
│  Step 1: Orchestrator（單次 AI call）     │
│  整合案件事實 + 爭議分類                  │
│  標記 information_gaps                   │
│                                         │
│  output:                                │
│    (a) 案件事實全貌                      │
│    (b) 法律議題清單（含事實爭議分類）      │
│    (c) information_gaps                  │
│    (d) 書狀類型確認                      │
│                                         │
│  ⚡ 立即推送到 UI 供律師檢視              │
│     （pipeline 不暫停，繼續往下跑）       │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ Step 2: 法律研究 Agent                    │
│ 批次展開 + MongoDB 搜尋                   │
│ 按爭點計數停止                            │
│ 產出法條 + 攻防分析 + 爭點強度評估         │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Step 3: 論證策略 Step（單次 AI call）     │
│  等 Step 1 + Step 2 都完成才啟動          │
│                                         │
│  input:                                 │
│    - 案件事實全貌 + 爭議分類（Step 1）    │
│    - 法條 + 攻防分析（Step 2）            │
│    - information_gaps（Step 1）           │
│                                         │
│  output:                                │
│    - 提取雙方 claims                     │
│    - 每段的論證框架                      │
│    - 每個 claim 的 assigned_section      │
└──────────────────┬──────────────────────┘
                   ▼
┌──────────────────────────────────────────┐
│  Step 4: Writer（Claude Citations × N）   │
│  逐段撰寫，每段動態組裝 context           │
│  每段拿到該段負責的 claims 列表           │
│  已完成段落全文傳入供後續段落引用        │
└──────────────────┬──────────────────────┘
                   ▼
┌──────────────────────────────────────────┐
│  Step 5a: 結構化前檢（純程式）            │
│  用 claims 做自動化檢查：                 │
│  - 每個 claim 是否有 assigned_section     │
│  - 每個 theirs claim 是否有同議題的反駁   │
│                                         │
│  Step 5b: 品質審查（LLM，僅回報）         │
│  input: 完整書狀 + 前檢結果              │
│         + 論證策略 output（對照計畫vs執行）│
│  output: 問題清單（不自動修正）           │
└──────────────────┬──────────────────────┘
                   ▼
              最終書狀輸出
                   │
                   ▼
         對話層（AgentDO）
         根據 information_gaps
         + 品質審查問題清單
         告知使用者需補充的資訊
```

---

## 4. Pipeline 流程與依賴關係分析

### 4.1 為什麼書狀結構規劃必須等法律研究完成

法律研究的結果經常會改變策略方向。例如本來以為可以走債務不履行，研究後發現走不當得利更有利，這時候整個論證結構都要變。

各步驟的依賴關係：

- **法律研究**需要：爭點列表 + 事實摘要（來自 Orchestrator）。不需要知道書狀怎麼寫。
- **論證策略**需要：事實整理結果 + 法律研究結果 + 書狀類型。必須知道手上有什麼法律武器才能設計策略和提取 claims。

結論：**Orchestrator 先跑完**，法律研究依賴 Orchestrator 的 output。**論證策略必須等 Orchestrator + 法律研究都完成後才啟動**。

### 4.2 執行時序

```
Orchestrator 完成
    │
    │  → 立即推送事實全貌到 UI
    │
    ├──→ 法律研究 Agent（用爭點驅動搜尋迴圈）
    │
    │  法律研究完成後：
    │
    └──→ 論證策略 Step → 逐段撰寫 → 品質審查
```

---

## 5. 各步驟詳細設計

### 5.1 Orchestrator（Step 1）

**職責**：整合散落在各檔案 summary 中的資訊，產出案件全貌，完成事實爭議分類，標記資訊缺口。

**為什麼需要**：目前 Planner 看到的是各檔案獨立的摘要，沒有人把它們整合成連貫的案件事實。例如起訴狀說「112年3月15日發生車禍」，診斷證明說「受傷住院20天」，交通事故分析說「被告闖紅燈」——需要有人拼成一個故事，標記每個事實的爭議狀態。

**為什麼不在 Orchestrator 提取 claims**：Claims 的提取需要同時考量法條和事實的對應關係，交給論證策略 Step（使用 Claude）在拿到法律研究結果後再做，品質更穩定。Orchestrator 使用 Flash 模型，專注在「資訊整合」這個單一任務，降低 JSON 出錯率。

**模型**：Gemini 2.5 Flash（資訊整合，不需要深度推理）。事實爭議分類品質需實測驗證，若不足可升級至 Claude Haiku（成本差異不大）或在品質審查階段加入「事實分類是否正確」的檢查維度。

**穩定性保障**：使用 Zod schema 驗證 output，parse 失敗自動 retry 一次。

**設計原則**：如果既有爭點分析已存在，Orchestrator 不重新生成爭點，而是專注在「跨檔案整合事實 + 爭議分類」。爭點清單直接從既有分析帶入，Orchestrator 可以補充或微調但不重做。

**格式對齊既有 Dispute**：Orchestrator 產出的 `legal_issues` 必須與現有的 `Dispute` 格式相容（`{ id, title, our_position, their_position }`），在其基礎上擴展 `facts`、`key_evidence`、`mentioned_laws` 等欄位。既有爭點作為「種子」傳入，Orchestrator 在其結構上附加事實分類，而非產出一套獨立的格式。這樣下游和 UI 可以無縫使用，不需要格式轉換。

**UI 推送**：Orchestrator 完成後，立即將案件事實全貌、事實爭議分類推送至 UI，供律師即時檢視。Pipeline 不暫停。

**Input Context**：

```
[System] 你是案件分析助理。整合以下檔案摘要，產出結構化的案件全貌分析，
對每個事實進行爭議分類。
如果發現資訊不足以支撐某項主張，標記在 information_gaps 中。

[檔案摘要]
- [file_1] 民事起訴狀 (ours)
  摘要: ...
  主張: ["被告闖紅燈致原告受傷", "請求醫療費用150萬"]
  日期: ["112年3月15日車禍發生"]
  金額: [1500000]

- [file_2] 診斷證明書 (evidence)
  摘要: ...
  日期: ["112年3月15日至4月5日住院"]

- [file_3] 民事答辯狀 (theirs)
  摘要: ...
  主張: ["原告與有過失", "醫療費用過高"]
  矛盾: ["被告先稱未超速，後改稱輕微超速"]

[既有爭點]（如果已分析過，直接沿用）
  1. 侵權行為是否成立 — 我方:... 對方:...

[損害賠償]（如果已計算）
  醫療費: 800,000 / 看護費: 200,000 / ...

[書狀類型] preparation
```

**Output 格式**：

```json
{
  "case_summary": "跨檔案整合的案件事實全貌",
  "parties": { "plaintiff": "王某某", "defendant": "李某某" },
  "timeline_summary": "112/3/15 車禍 → 112/3/15-4/5 住院 → ...",
  "brief_type": "preparation",

  "legal_issues": [
    {
      "id": "issue_1",
      "title": "侵權行為是否成立",
      "our_position": "被告闖紅燈有過失",
      "their_position": "原告與有過失",
      "key_evidence": ["file_1", "file_2"],
      "mentioned_laws": ["民法第184條"],
      "facts": [
        {
          "id": "fact_1",
          "description": "112年3月15日被告闖紅燈",
          "assertion_type": "爭執",
          "source_side": "我方",
          "evidence": ["交通事故鑑定報告", "行車紀錄器"],
          "disputed_by": "被告主張號誌為黃燈"
        },
        {
          "id": "fact_2",
          "description": "原告當時時速未超過40公里",
          "assertion_type": "爭執",
          "source_side": "我方",
          "evidence": ["行車紀錄器"],
          "disputed_by": "被告主張原告超速"
        },
        {
          "id": "fact_3",
          "description": "原告因車禍住院20天",
          "assertion_type": "承認",
          "source_side": "中立",
          "evidence": ["診斷證明書"],
          "disputed_by": null
        }
      ]
    }
  ],

  "information_gaps": [
    {
      "id": "gap_1",
      "severity": "critical",
      "description": "被告主張原告與有過失，但我方目前無直接證據反駁原告行車速度",
      "related_issue_id": "issue_1",
      "suggestion": "提供行車紀錄器完整影片或測速數據"
    },
    {
      "id": "gap_2",
      "severity": "nice_to_have",
      "description": "有住院診斷證明但缺少後續復健紀錄",
      "related_issue_id": "issue_2",
      "suggestion": "提供復健診所就診紀錄及費用單據"
    }
  ]
}
```

### 5.2 法律研究 Agent（Step 2）

**職責**：為每個法律議題搜尋相關法條，分析攻防策略。

**為什麼是 Agent**：唯一需要 tool loop 的步驟。需要自主判斷搜尋結果品質、決定是否重試。

**模型**：Gemini 2.5 Flash（搜尋迴圈），攻防分析品質需實測驗證，若不足可考慮拆分：搜尋用 Flash，最終攻防分析用 Claude。

**工具**：`search_law(query, limit)` — 呼叫現有的 `searchLaw()` 函式

**搜尋策略：批次展開 + MongoDB**

不讓 Agent 一輪一輪慢慢搜，而是在第一輪就讓 LLM 根據爭點一次性列出所有候選法條，然後批次查 MongoDB：

```
Round 1: LLM 根據爭點，一次產出候選法條清單
  → ["民法184", "民法191-2", "民法217", "民法193", "民法195", "民訴法277"]

Round 2: 批次查 MongoDB（全部一起查）
  → 命中 5 條，"民訴法277" 沒命中

Round 3: LLM 看結果，補查沒命中的（換關鍵字）+ 判斷是否還需要更多
  → 搜「民事訴訟法第277條」→ 命中
  → 判斷：夠了，產出攻防分析
```

**停止條件：按爭點計數**

```python
for issue in issues:
    issue.rounds = 0
    issue.completed = False

    while not issue.completed and issue.rounds < MAX_ROUNDS_PER_ISSUE:  # 建議 5
        result = search_and_analyze(issue)
        issue.rounds += 1

        issue.completed = all([
            result.has_legal_basis,             # 至少一條請求權基礎
            result.elements_mappable,           # 構成要件可涵攝
            result.has_defense_law_searched,    # 至少搜尋過 1 條 defense_risk 法條
            result.defense_identified,          # 已識別對方抗辯
        ])

    issue.strength = assess_strength(result)  # strong / moderate / weak / untenable

    if total_tokens_used > TOKEN_BUDGET:
        break  # 全局安全網
```

> **注意**：停止條件中 `has_defense_law_searched` 要求的是「至少搜尋過 1 條 defense_risk 標記的法條」，而非僅在 output 中提及。防止 LLM 自我滿足——只寫「對方可能主張...」但沒有真的搜尋驗證。

**`has_defense_law_searched` 程式端追蹤**：

不能只看 LLM 最終 output 裡有沒有 `side: "defense_risk"` 的條目來判斷——LLM 可能在分析中「提及」對方法條但沒有真的搜過。必須在程式端追蹤實際搜尋紀錄：

```typescript
// 在 tool loop 中維護，每次 search_law 回傳時記錄
const searchedLawIds = new Set<string>();

// search_law tool handler 中：
const handleSearchLaw = async (query: string, limit: number) => {
  const results = await searchLaw(query, limit);
  for (const r of results) {
    searchedLawIds.add(r._id);
  }
  return results;
};

// 停止條件檢查：比對 LLM 標記為 defense_risk 的法條 ID 是否真的在 searchedLawIds 中
const hasDefenseLawSearched = defenseLawIds.some(id => searchedLawIds.has(id));
```

這樣即使 LLM 在 output 中標記了某條法條為 `defense_risk`，但實際沒有搜尋過，停止條件也不會被滿足。

**防護機制**：

| 機制 | 設定 | 原因 |
|------|------|------|
| 單議題上限 | 每個 issue 最多 5 輪 | 防止卡在一個議題 |
| 最大搜尋次數 | 20 次 | 防止 MongoDB 過載 |
| Wall clock 超時 | 30 秒（`setTimeout` 強制中斷） | MongoDB 偶爾延遲，防止整體卡住 |
| Token 預算 | 全局安全網 | 成本控制 |

**實作備註**：
- Tool loop 複用現有的 `callAIStreaming()` + `parseOpenAIStream()` 機制（與 AgentDO 同架構）
- 批次查詢直接使用現有的 `searchLawBatch()`（單一 MongoDB 連線，已支援批次）
- Wall clock timeout 使用 `setTimeout` + `AbortController`，與現有 pipeline 的 abort 機制一致
- **批次展開階段使用 `Promise.all` 平行搜尋**：Round 1 LLM 列出候選法條後，所有查詢同時發出而非逐一等待。MongoDB 單次查詢 P95 可能 >500ms，6 條法條序列搜尋要 3 秒以上，平行搜尋可壓到 ~500ms。實作上在 `searchLawBatch()` 內部已是單一連線，但外層可以用 `Promise.all` 同時發出多個 query：

```typescript
// Round 1: LLM 列出候選法條 → 平行搜尋
const candidateLaws = llmOutput.candidate_laws; // ["民法184", "民法191-2", ...]
const results = await Promise.all(
  candidateLaws.map(q => searchLaw(env, q, 3))
);
```

**System Prompt**：

```
你是法律研究助理。根據案件議題，搜尋相關法條並分析攻防。

你有一個工具：search_law(query, limit)

═══ 研究策略 ═══

對每個議題，先一次性列出所有可能需要的法條（包括對方可能用的），然後批次搜尋。

1. 核心法條（直接命中）
   搜「民法第184條」「民法第195條」等具體條號

2. 相關條文（擴展搜尋）
   搜「民法 侵權行為」「民法 損害賠償」等概念

3. 程序法條（攻防需要）
   搜「民事訴訟法第277條」等舉證責任相關
   思考對方可能引用什麼法條來反駁

═══ 搜尋技巧 ═══

- 搜不到時：換全名（消保法→消費者保護法）、拆分查詢、用更廣的概念
- 結果不相關時：加上法規名稱限縮範圍
- 每個議題至少搜 2 次（核心 + 擴展）
- 支援的常見縮寫：消保法、勞基法、個資法、國賠法、民訴法、刑訴法等

═══ 搜尋格式 ═══

- 特定條號（最精準）：「民法第184條」
- 法規+概念：「民法 損害賠償」
- 純概念：「侵權行為」
- 每次只搜一個條文，多條分次搜

═══ 攻防標記 ═══

- attack: 支持我方主張的法條
- defense_risk: 對方可能引用來反駁的法條（必須實際搜尋驗證，不可僅在分析中提及）
- reference: 背景參考

═══ 爭點強度評估 ═══

搜尋完成後，對每個爭點評估強度：
- strong: 有明確法律依據 + 強事實支撐
- moderate: 有法律依據但事實或證據有弱點
- weak: 法律依據薄弱或事實不利
- untenable: 站不住腳，建議律師重新考慮策略

═══ 完成條件（按爭點計數）═══

每個議題獨立判斷：
① 至少找到 1 條 attack 法條
② 至少搜尋過 1 條 defense_risk 法條（不只是提及，要實際搜過）
③ 構成要件可與事實對應

三個條件都滿足 → 該議題完成 | 任一不滿足 → 繼續查（每個議題最多 5 輪）
```

**Output 格式**：

```json
{
  "research": [
    {
      "issue_id": "issue_1",
      "strength": "strong",
      "found_laws": [
        {
          "id": "B0000001-第 184 條",
          "law_name": "民法",
          "article_no": "第 184 條",
          "content": "因故意或過失，不法侵害他人之權利者...",
          "relevance": "侵權行為成立之基本要件",
          "side": "attack"
        },
        {
          "id": "B0000001-第 191-2 條",
          "law_name": "民法",
          "article_no": "第 191-2 條",
          "content": "汽車、機車或其他非依軌道行駛之動力車輛...",
          "relevance": "推定汽車駕駛人有過失，舉證責任倒置",
          "side": "attack"
        },
        {
          "id": "B0000001-第 217 條",
          "law_name": "民法",
          "article_no": "第 217 條",
          "content": "損害之發生或擴大，被害人與有過失者...",
          "relevance": "對方可能主張與有過失減輕賠償",
          "side": "defense_risk"
        }
      ],
      "analysis": "依民法第184條第1項前段，侵權行為之成立需具備故意或過失。本案可援引第191條之2推定被告過失，舉證責任倒置有利我方。須注意對方可能依第217條主張與有過失。",
      "attack_points": [
        "被告闖紅燈，已構成過失要件",
        "依191-2條推定過失，被告應舉證免責"
      ],
      "defense_risks": [
        "對方可能依217條主張原告與有過失",
        "需準備反駁與有過失之事實論據"
      ]
    }
  ]
}
```

### 5.3 論證策略 Step（Step 3）

**職責**：拿到所有素材後，從案件事實和法律研究中提取雙方 claims，設計每段的論證結構，將每個 claim 分配到具體段落。這是 Pipeline 中最關鍵的「策略層」。

**為什麼重要**：目前的 Planner 在沒有法條的情況下寫 instruction，等於叫律師「不看法條就設計論證」。論證策略 Step 拿到法條 + 事實 + 攻防分析後才設計論證，品質會好很多。

**為什麼 claims 在這裡提取**：Claims 的品質取決於對法條和事實的精確理解。Orchestrator 使用 Flash 模型做資訊整合，額外要求它提取 claims 會增加 JSON 複雜度和出錯率。論證策略使用 Claude，拿到法律研究結果後再提取 claims，能同時完成「提取主張」和「設計策略」，一次到位。

**模型**：Claude（需要深度法律推理能力）

**邊界原則**：論證策略負責「提取雙方主張 + 決定用什麼牌、怎麼排」，Writer 負責「怎麼用文字表達」。論證策略聚焦在 claims 提取、法條選擇、論點排序、攻防安排、claim 分配，不寫具體寫作指示。

**Single Point of Failure 防護**：論證策略是單次 call，output 品質直接決定書狀品質。對策：程式端用 Zod schema + 語意驗證（每段有 claim、每個 dispute 有 section）檢查 output，驗證失敗自動 retry 一次。詳見 [5.6 降級策略](#56-降級策略error-path)。

**information_gaps 的影響**：論證策略看得到 Orchestrator 標記的 information_gaps。對於 `critical` 級別的缺口，策略應避開沒有證據支撐的論點或使用保守措辭。對於 `nice_to_have` 級別，可正常論證但標記為可強化。

**Input Context**：

```
[System] 你是資深訴訟律師。根據案件事實和法律研究結果，
提取雙方的主張（claims），設計每個段落的論證策略，
並將每個主張分配到具體段落。

[案件全貌]（from Orchestrator，含事實爭議分類）

[法律研究結果]（from 法律研究 Agent，含爭點強度評估）

[Information Gaps]（from Orchestrator）

[爭點清單]（from Orchestrator / 既有爭點分析）

[書狀類型] preparation
```

**Output 格式**：

```json
{
  "claims": [
    {
      "id": "our_claim_1",
      "side": "ours",
      "statement": "被告闖紅燈違反注意義務，依民法184條構成過失侵權",
      "assigned_section": "section_2"
    },
    {
      "id": "their_claim_1",
      "side": "theirs",
      "statement": "原告與有過失，應減輕被告賠償責任",
      "assigned_section": null
    },
    {
      "id": "our_claim_2",
      "side": "ours",
      "statement": "原告正常行駛無與有過失之情事，被告依217條之主張無據",
      "assigned_section": "section_2"
    },
    {
      "id": "their_claim_2",
      "side": "theirs",
      "statement": "原告主張之醫療費用過高，不合理",
      "assigned_section": null
    },
    {
      "id": "our_claim_3",
      "side": "ours",
      "statement": "醫療費用均有單據佐證，合理必要",
      "assigned_section": "section_3"
    }
  ],

  "sections": [
    {
      "id": "section_1",
      "section": "壹、前言",
      "argumentation": {
        "legal_basis": [],
        "fact_application": "簡述案件背景、訴訟經過",
        "conclusion": "本狀針對被告答辯逐一反駁"
      },
      "claims": ["our_claim_1"],
      "relevant_file_ids": ["file_1"],
      "relevant_law_ids": []
    },
    {
      "id": "section_2",
      "section": "貳、對對造主張之意見",
      "subsection": "一、侵權行為確已成立",
      "dispute_id": "issue_1",
      "argumentation": {
        "legal_basis": ["B0000001-第 184 條", "B0000001-第 191-2 條"],
        "fact_application": "被告闖紅燈 → 違反注意義務 → 構成過失。依191-2條推定過失，被告未能舉證推翻",
        "conclusion": "被告侵權行為成立"
      },
      "claims": ["our_claim_1", "our_claim_2"],
      "relevant_file_ids": ["file_1", "file_4"],
      "relevant_law_ids": [
        "B0000001-第 184 條",
        "B0000001-第 191-2 條",
        "B0000001-第 217 條"
      ],
      "facts_to_use": [
        {
          "fact_id": "fact_1",
          "assertion_type": "爭執",
          "usage": "作為過失要件的核心事實論據"
        },
        {
          "fact_id": "fact_3",
          "assertion_type": "承認",
          "usage": "援引對方不爭執之住院事實，強化損害因果關係"
        }
      ]
    }
  ],

  "claim_coverage_check": {
    "uncovered_their_claims": ["their_claim_2"],
    "note": "their_claim_2（醫療費用過高）將在損害賠償段落回應"
  }
}
```

### 5.4 Writer — 逐段撰寫（Step 4）

**職責**：根據論證結構撰寫每段書狀內容，使用 Claude Citations API 標記引用來源。

**模型**：Claude（使用 Citations API）

**每段 Context 組裝（三層結構）**：

| Context 層級 | 內容 | 目的 | 長度控制 |
|-------------|------|------|---------|
| 背景層 | 案件摘要、書狀類型、完整大綱 + 當前位置 | 讓 LLM 知道全局 | 短，壓縮過的摘要 |
| 焦點層 | 本段的 claims 列表、論證結構、法條全文、相關檔案 | 精確完成本段 | 只放本段需要的，嚴格篩選 |
| 回顧層 | 已完成段落全文 | 維持前後文一致性 | 直接傳全文，不做漸進壓縮 |

**關鍵設計決策：回顧層使用全文而非摘要**

使用 200K token 模型（如 Claude），已完成段落全文加起來通常只有幾千字，不需要壓縮。漸進壓縮反而可能導致 LLM 忘記前面段落的關鍵專有名詞或精確定義。真正該控制的是焦點層（外部注入的法條和來源文件），而非自己生成的草稿。

**Writer 每段的 Output Schema**：

```json
{
  "content": "按因故意或過失，不法侵害他人之權利者...",
  "citations": [...]
}
```

**Writer Context 範例**：

```
[System Prompt]
你是台灣資深訴訟律師。請根據提供的論證結構和來源文件，撰寫法律書狀段落。

[書狀全局資訊]
  書狀類型：民事準備書狀
  完整大綱：
    壹、前言                           ← 已完成
    貳、一、侵權行為確已成立            ← 【你正在寫這段】
    貳、二、損害賠償範圍應予維持         ← 下一段會寫
    參、結論

[本段負責的 Claims]
  our_claim_1: 被告闖紅燈違反注意義務，依民法184條構成過失侵權
  our_claim_2: 原告正常行駛無與有過失之情事，被告依217條之主張無據

[本段論證結構]（from 論證策略 Step）
  大前提（法律依據）：民法第184條第1項前段、第191條之2
  小前提（事實適用）：被告闖紅燈→違反注意義務→過失成立。依191-2推定過失。
  結論：被告侵權行為成立
  事實運用：fact_1（爭執，核心論據）、fact_3（承認，直接援引）

[來源文件]（透過 Citations API 提供，只放本段需要的）
  - 起訴狀.pdf
  - 交通事故分析報告.pdf

[法條全文]（透過 Citations API 提供，只放本段需要的）
  - 民法第184條：因故意或過失，不法侵害他人之權利者...
  - 民法第191條之2：汽車、機車或其他非依軌道行駛之動力車輛...
  - 民法第217條：損害之發生或擴大，被害人與有過失者...

[已完成段落]（全文傳入，不壓縮）
  壹、前言：
  「緣本件原告因112年3月15日發生之交通事故...」

[撰寫規則]
  - 使用正式法律文書用語（繁體中文）
  - 依照論證結構和 claims 列表撰寫
  - 引用法條時從提供的法條文件中引用
  - 引用事實時從提供的來源文件中引用
  - 對「承認」的事實，可使用「此為兩造所不爭執」等用語
  - 對「爭執」的事實，需提出證據佐證
  - 對「自認」的事實，使用「被告於答辯狀自承」等用語
  - 不要輸出章節標題
  - 段落長度 150-400 字
```

**vs 現在的 Writer context 對比**：

| | 現在 | v3 |
|--|------|-----|
| 全局視野 | 只有前一段全文 | 完整大綱 + 當前位置 |
| 論證指引 | 一句 instruction | 完整的大前提→小前提→結論 + claims 列表 |
| 法條 | Planner 猜的 | 法律研究 Agent 驗證過的 + 攻防標記 |
| 事實分類 | 無 | 每個事實有 assertion_type / source_side |
| 前段 | 全文（不知道整體結構） | 全文 + 全局大綱位置標記 |

### 5.5 品質審查（Step 5）

品質審查分為兩階段：程式化結構前檢（5a）+ LLM 語意審查（5b）。**本階段僅回報問題，不自動修正**——自動修正迴圈待累積實際數據後再評估是否加入。

#### Step 5a：結構化前檢（純程式，無 LLM 成本）

利用 claims 做自動化檢查，在 LLM 審查之前先抓出明顯的結構問題：

```typescript
const structuralPreCheck = (claims: Claim[], sections: StrategySection[]): PreCheckResult => {
  const issues: PreCheckIssue[] = [];

  // 1. 每個 ours claim 是否有 assigned_section
  for (const claim of claims.filter(c => c.side === 'ours')) {
    if (!claim.assigned_section) {
      issues.push({
        severity: 'critical',
        type: 'unassigned_claim',
        description: `我方主張 "${claim.statement}" 未被分配到任何段落`,
      });
    }
  }

  // 2. 每個 theirs claim 是否有同議題的 ours claim 回應
  const theirClaims = claims.filter(c => c.side === 'theirs');
  const ourClaims = claims.filter(c => c.side === 'ours');
  for (const theirClaim of theirClaims) {
    // 檢查是否有任何 ours claim 被分配到了會回應此議題的段落
    const hasResponse = ourClaims.some(c =>
      c.assigned_section && sections.some(s =>
        s.id === c.assigned_section && s.dispute_id === theirClaim.issue_id
      )
    );
    if (!hasResponse) {
      issues.push({
        severity: 'warning',
        type: 'uncovered_opponent_claim',
        description: `對方主張 "${theirClaim.statement}" 無對應回應`,
      });
    }
  }

  // 3. 每個 dispute 是否有對應段落
  const coveredDisputes = new Set(sections.map(s => s.dispute_id).filter(Boolean));
  // （需傳入 legalIssues 做交叉比對）

  return { issues };
};
```

#### Step 5b：LLM 品質審查（僅回報，不自動修正）

**模型**：Claude

**關鍵設計**：品質審查的 input 包含論證策略的 output + 結構前檢結果，讓審核員能對照「計畫 vs 執行」並知道哪些結構問題已被程式偵測。

**Input**：

- 完整書狀全文
- 所有爭點清單
- 所有搜尋到的法條
- 論證策略的 sections output（含 claims）
- 結構化前檢結果（Step 5a）
- information_gaps（告知審核員哪些是已知缺口）

**審核維度**：

| 審查維度 | 檢查內容 | 嚴重度 |
|---------|---------|--------|
| 法律正確性 | 法條引用是否正確、要件是否完整涵攝 | Critical |
| 邏輯一致性 | 各段論述是否自相矛盾 | Critical |
| 事實與主張對應 | 每個法律主張是否有事實支撐 | Critical |
| 策略執行度 | Writer 是否遵循論證策略的安排 | Critical |
| 策略風險 | 是否有自我矛盾或不利陳述 | Critical |
| 證據引用 | 每個事實主張是否有對應證據 | Warning |
| 爭點覆蓋 | 是否所有爭點都有對應段落 | Warning |
| 重複論點 | 不同段落是否重複相同論點 | Warning |
| 格式合規 | 是否符合法院要求的格式 | Warning |
| 事實分類正確性 | Orchestrator 的事實爭議分類是否合理 | Warning |

**Output**：

```json
{
  "passed": false,
  "structural_issues_from_precheck": 2,
  "issues": [
    {
      "paragraph_id": "section_3",
      "severity": "critical",
      "type": "missing_citation",
      "description": "段落提及民法第195條但未正式引用",
      "suggestion": "補充民法第195條全文引用"
    },
    {
      "paragraph_id": "section_5",
      "severity": "warning",
      "type": "weak_argument",
      "description": "結論過於簡略，未總結第二個爭點的論述",
      "suggestion": "補充損害賠償部分的結論"
    }
  ]
}
```

**品質審查結果的使用**：問題清單連同 information_gaps 一起交給對話層（AgentDO），由 AgentDO 整合後告知使用者。使用者可根據建議手動修改或觸發單段重寫。

### 5.6 降級策略（Error Path）

每個步驟的失敗場景和降級處理：

| 步驟 | 失敗場景 | 降級策略 |
|------|---------|---------|
| Orchestrator | 檔案摘要品質差導致事實整合不完整 | 標記 information_gaps，繼續執行 |
| 法律研究 | 某 issue 跑完 5 輪仍 `strength: weak` | 論證策略標記該段為「法律依據薄弱，需律師補充」 |
| 法律研究 | 所有 issues 都是 `weak/untenable` | 品質審查在回應中明確提醒使用者 |
| 論證策略 | 單次 call 品質不佳 | 程式端 output validation + 自動 retry（詳見下方） |
| Writer | 某段落引用不足 | 品質審查標記，告知使用者 |
| 品質審查 | 審查本身失敗 | 輸出書狀 + 結構前檢結果，跳過 LLM 審查 |

**論證策略 Output Validation（程式端）**：

論證策略是 single point of failure——單次 call 錯了全盤皆輸。不能只靠 LLM 自我檢查，必須在程式端做結構驗證：

```typescript
const validateStrategyOutput = (output: StrategyOutput, legalIssues: LegalIssue[]): ValidationResult => {
  const errors: string[] = [];

  // 1. 每個 section 至少有一個 claim（前言/結論除外）
  for (const section of output.sections) {
    if (!['前言', '結論'].some(k => section.section.includes(k)) && section.claims.length === 0) {
      errors.push(`${section.section} 沒有分配任何 claim`);
    }
  }

  // 2. 每個 dispute 都有對應 section
  for (const issue of legalIssues) {
    const covered = output.sections.some(s => s.dispute_id === issue.id);
    if (!covered) errors.push(`爭點 ${issue.title} 沒有對應段落`);
  }

  // 3. 每個 claim 的 assigned_section 指向有效的 section
  const sectionIds = new Set(output.sections.map(s => s.id));
  for (const claim of output.claims) {
    if (claim.assigned_section && !sectionIds.has(claim.assigned_section)) {
      errors.push(`Claim "${claim.statement}" 指向不存在的段落 ${claim.assigned_section}`);
    }
  }

  return { valid: errors.length === 0, errors };
};

// 驗證失敗 → 自動 retry 一次，注入錯誤訊息讓 LLM 針對性修正
// （單純 retry 容易犯同樣的錯，注入錯誤後 LLM 能針對性修正）
if (!validation.valid) {
  const retryResult = await callClaude({
    messages: [
      ...originalMessages,
      { role: 'assistant', content: JSON.stringify(firstAttemptOutput) },
      { role: 'user', content:
        `你上一次的輸出有以下結構問題，請修正後重新輸出完整 JSON：\n` +
        validation.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
      }
    ]
  });
}
```

---

## 6. Claim Graph 設計

### 6.1 設計理念

目前 `legal_issues` 是「議題導向」的，但書狀的論證是「主張導向」的。一個議題下面可能有多個 claim，claim 之間有攻防關係。Claim graph 將這些關係從隱含在自然語言中提取為可追蹤的結構化資料，不需要上知識圖譜，只要 ID 關係。

### 6.2 資料結構

**Phase 1（簡化版）**：只追蹤 claim 的歸屬和段落分配，不做精確的 fact/law 交叉引用。

```typescript
interface Claim {
  id: string;                    // "our_claim_1", "their_claim_1"
  side: 'ours' | 'theirs';      // 哪一方的主張
  statement: string;             // 一句話描述這個主張
  assigned_section?: string;     // 這個 claim 被安排在哪個段落（論證策略分配）
}
```

**Phase 3（完整版）**：加入攻防關係和精確的 fact/law 對應。

```typescript
interface ClaimFull extends Claim {
  issue_id: string;              // 歸屬哪個 legal_issue
  type: 'attack' | 'rebuttal';  // attack: 主動進攻; rebuttal: 反駁對方
  target?: string;               // rebuttal 時指向對方的 claim_id
  supported_by: {
    facts: string[];             // fact_id[]
    laws: string[];              // law_id[]
    evidence: string[];          // file_id[] 或證據名稱
  };
}
```

> **為什麼分階段**：要求 LLM 在單次 call 中同時精確填寫 fact_id 和 law_id 的交叉引用容易出錯（ID 映射跨越不同 context 來源）。Phase 1 先驗證核心流程——claims 提取 + 段落分配——的品質，再逐步加入精確對應。

### 6.3 產生時機

| 版本 | 產出者 | 產出內容 |
|------|--------|---------|
| Phase 1 | 論證策略 Step | `statement` + `side` + `assigned_section` |
| Phase 3 | 論證策略 Step | 補完 `type`、`target`、`supported_by`（根據法律研究結果填入精確的 fact_id + law_id） |

### 6.4 Claim Graph 的下游價值

**對 Writer**：每段拿到的不再是模糊的 instruction，而是明確的 claims 列表。Writer 的任務從「根據 instruction 寫段落」變成「把這 2-3 個 claims 用法律論述串起來」，確定性更高。

**對品質審查（程式前檢 — Phase 1）**：

- 每個 `ours` claim 是否有 `assigned_section` → 抓出沒被安排進書狀的主張
- 每個 `theirs` claim 是否有同議題的回應 → 抓出漏回的對方主張

**對品質審查（程式前檢 — Phase 3 加入後）**：

- 每個 `ours` claim 的 `supported_by` 是否非空 → 抓出無支撐的主張
- rebuttal 的 `target` 是否真的存在 → 抓出指向錯誤

**對品質審查（LLM）**：審核員可以檢查 Writer 是否在段落中確實表達了分配給該段的所有 claims。

### 6.5 範例：攻防關係（Phase 1 簡化版）

```
issue_1: 侵權行為是否成立

  our_claim_1 (ours)
    「被告闖紅燈構成過失侵權」
    assigned_section: section_2

  their_claim_1 (theirs)
    「原告與有過失」
    assigned_section: null（論證策略會安排 ours claim 回應）

  our_claim_2 (ours)
    「原告正常行駛無與有過失」
    assigned_section: section_2

  their_claim_2 (theirs)
    「醫療費用過高」
    assigned_section: null

  our_claim_3 (ours)
    「醫療費用均有單據佐證，合理必要」
    assigned_section: section_3
```

---

## 7. Context Engineering 策略

### 7.1 正確做法 vs 錯誤做法

| 錯誤做法 | Context Engineering 做法 |
|----------|---------------------------|
| 把所有資料一股腦塞給每個 step | 每個 step 只看到它需要的資訊 |
| 上游產出一大段文字，整包丟給下游 | 上游產出結構化 JSON，下游按欄位取用 |
| 已完成段落做漸進壓縮 | 已完成段落直接傳全文（200K context 足夠） |
| 所有法條全部注入 | 只注入本段 relevant_law_ids 的法條 |
| 所有檔案全部注入 | 只注入本段 relevant_file_ids 的檔案 |
| 論證結構用自然語言描述 | Claims 用結構化 ID 關係 |

### 7.2 Token 預算分配原則

真正該控制的是外部注入的焦點層（法條和來源文件），而非自己生成的回顧層（已完成段落）。

每段 Writer 呼叫的 context 預算分配：

| 層級 | 預估 Token | 控制策略 |
|------|-----------|---------|
| System prompt | ~1-2K | 固定 |
| 書狀全局大綱 | ~500-1K | 固定 |
| 本段 claims + 論證結構 | ~500-1K | 固定 |
| 來源文件（焦點層） | 5-20K | **嚴格限制：只放本段相關檔案** |
| 法條全文（焦點層） | 1-3K | **嚴格限制：只放本段需要的 3-5 條** |
| 已完成段落全文（回顧層） | 2-8K | 不壓縮，隨段落數自然增長 |
| **總計** | **~12-35K** | 遠低於 200K 上限 |

### 7.3 寫入端與讀取端分離

上游 step 產出時，按照下游的需求格式寫入。下游可能只需要上游輸出的 30%。透過結構化輸出（JSON）讓下游可以精確引用：

- **Orchestrator** 產出結構化事實 + 爭議分類 → 法律研究只取爭點、論證策略取全部、Writer 按段取用
- **法律研究** 產出法條 + 攻防分析 → 論證策略取全部、Writer 按 relevant_law_ids 取用
- **論證策略** 產出 claims + 每段論證框架 → Writer 逐段取用 claims 和論證結構、品質審查拿全部做對照

---

## 8. 事實版本與爭議管理系統

### 8.1 設計理念

法律書狀的核心不是「陳述事實」，而是「在有爭議的事實中建構對我方有利的敘事」。事實的爭議分類直接影響：

- **論證策略**：`承認` 的事實不用花篇幅論證，`爭執` 的事實需要重點論證
- **Writer 用語**：`承認` 用「此為兩造所不爭執」，`自認` 用「被告於答辯狀自承」
- **攻防安排**：`爭執` 且缺乏證據的事實考慮避開或補強

### 8.2 事實分類欄位

```typescript
interface StructuredFact {
  id: string;
  description: string;
  assertion_type: '主張' | '承認' | '爭執' | '自認' | '推定';
  source_side: '我方' | '對方' | '中立';
  evidence: string[];
  disputed_by: string | null;
}
```

各欄位說明：

| 欄位 | 值 | 說明 |
|------|---|------|
| assertion_type | 主張 | 一方提出但對方尚未回應 |
| | 承認 | 雙方無爭議 |
| | 爭執 | 雙方說法不同 |
| | 自認 | 對方在書狀中明確承認（有拘束力） |
| | 推定 | 法律上推定為真（如推定過失） |
| source_side | 我方 / 對方 / 中立 | 影響引用方式 |
| disputed_by | string / null | 事實層面的反駁（法律層面的攻防留給法律研究 Agent） |

### 8.3 產生時機

在 Orchestrator 階段一起產生（不額外增加 LLM 呼叫）。Orchestrator 本來就在讀所有檔案摘要、整合案件事實，在這個過程中順便標記每個事實的分類，幾乎是零額外成本。

### 8.4 下游影響

- **論證策略 Step**：根據 `assertion_type` 決定論證重點——`爭執` 的事實重點論證，`自認` 的事實提醒 Writer 要明確援引
- **Writer**：根據 `assertion_type` 選擇正確用語；根據 `source_side` 選擇正確引用方式
- **品質審查**：檢查是否有 `爭執` 事實缺乏證據引用；檢查事實分類本身是否合理

### 8.5 律師端 UI（兩層設計）

**第一層：AI 自動產出，律師可覽。** Orchestrator 跑完後，立即在 UI 上展示事實分類結果。不阻擋 pipeline——pipeline 繼續自動跑（vibe coding 模式），但律師隨時可以查看。

**第二層：律師手動修改，觸發局部重跑。** 律師發現分類有誤可手動改。改完後系統提示「事實分類已更新，是否重新生成受影響的段落」——只需重跑論證策略和受影響段落的 Writer，不重跑整個 pipeline。

### 8.6 程式碼複用

事實爭議分析的邏輯寫成可複用的函式：Orchestrator 內部呼叫它，但它也可以被 UI 上的「分析爭議事項」按鈕獨立觸發（使用者還沒觸發寫書狀、只在整理案件時使用）。同一份程式碼，兩個入口。

---

## 9. 法律研究 Agent 設計

### 9.1 為什麼不做混合檢索（向量 + 圖譜）

當前階段保持 Agent + MongoDB 關鍵字搜尋架構，不建構向量資料庫和法源關聯圖譜。原因：

- Agent 的自主決策能力已經在彌補檢索系統的不足（LLM 擅長「法律聯想」——想到對方會用什麼法條）
- 混合檢索的結果仍需 LLM 過濾判斷，沒有省掉 LLM 工作
- 向量資料庫和圖譜的建構成本高，短期 ROI 不足

### 9.2 改良策略：批次展開 + MongoDB

與其讓 Agent 一輪一輪慢慢搜，在第一輪就讓 LLM 根據爭點一次性列出所有候選法條，然後批次查 MongoDB。好處：

- 保留 LLM 的法律聯想能力
- 減少 Agent 迴圈次數（從 5-10 輪降到 2-3 輪）
- 不需要新的基礎建設
- 程式改動小（只改 Agent 的 prompt 策略）

### 9.3 立場不利的回饋機制

法律研究 Agent 在輸出中標記爭點強度（strong / moderate / weak / untenable）。

- 論證策略看到 `weak` 時，避開該論點或使用保守措辭
- Writer 根據強度標記調整語氣
- 如果所有爭點都是 `weak/untenable`，品質審查在回應中明確提醒使用者
- 對話層（AgentDO）將此資訊整合進 information_gaps 回饋

不另設獨立機制。

---

## 10. 資訊不足處理機制

### 10.1 設計理念

「全程不打斷使用者」和「資訊不足不腦補」的衝突，透過**責任分離**解決：

- **Pipeline**：有什麼材料就用什麼材料，遇到不足標記 `information_gaps` 但繼續執行
- **對話層（AgentDO）**：書狀產出後，根據 information_gaps 告知使用者需要補充什麼

### 10.2 information_gaps 分級

| 級別 | 定義 | Pipeline 行為 | 對話層表達 |
|------|------|-------------|-----------|
| `critical` | 缺了會讓論證站不住腳 | 論證策略避開或保守措辭，Writer 不腦補 | 「建議補充以下資料後重新生成」 |
| `nice_to_have` | 有了會更好但不致命 | 正常論證但標記為可強化 | 「如果手邊有以下資料，補上後可以讓論證更完整」 |

### 10.3 各步驟如何使用 information_gaps

| 步驟 | 使用方式 |
|------|---------|
| Orchestrator | 產生 information_gaps，標記缺口和嚴重度 |
| 法律研究 | 看得到 gaps，但主要依據爭點搜尋，不受 gaps 阻擋 |
| 論證策略 | 看得到 gaps。`critical` 級別的缺口 → 避開無證據論點或標記「需律師補充」。`nice_to_have` → 正常設計但備註 |
| Writer | 間接影響——透過論證策略的安排，Writer 不會被指派去寫沒有材料支撐的 claim |
| 品質審查 | 看得到 gaps。不會把已知缺口標記為新問題，但會檢查 Writer 是否在缺口處腦補了事實 |
| 對話層 | 書狀完成後，向使用者展示 information_gaps + 品質審查問題清單，區分語氣 |

### 10.4 使用者補充資料後的處理

使用者補充資料後，不需要重跑整個 pipeline：

1. 更新相關檔案摘要
2. 重跑 Orchestrator（更新事實 + 移除已解決的 gaps）
3. 重跑法律研究（如果新資料影響法律策略）
4. 重跑論證策略 + 受影響段落的 Writer
5. 重跑品質審查

---

## 11. Context Store 設計

### 11.1 設計理念

所有步驟的產出集中存放，下游按需取用。不是「整包傳遞」，而是「查詢自己需要的東西」。

### 11.2 資料結構

```typescript
// LegalIssue 擴展既有 Dispute 格式，保持 { id, title, our_position, their_position } 相容
interface LegalIssue {
  id: string;                        // 對應既有 Dispute.id
  title: string;                     // 對應既有 Dispute.title（非 topic）
  our_position: string;              // 對應既有 Dispute.our_position
  their_position: string;            // 對應既有 Dispute.their_position
  // 以下為 Orchestrator 擴展欄位
  key_evidence: string[];            // 相關檔案 ID
  mentioned_laws: string[];          // 提及的法條
  facts: StructuredFact[];           // 事實爭議分類
}

interface ContextStore {
  // Step 1: Orchestrator 產出
  caseSummary: string;
  parties: { plaintiff: string; defendant: string };
  timelineSummary: string;
  briefType: string;
  legalIssues: LegalIssue[];       // 擴展自既有 Dispute，含 facts 爭議分類
  informationGaps: InformationGap[];

  // Step 2: 法律研究 Agent 產出
  research: ResearchResult[];       // 按 issue_id 分組的法條 + 攻防分析

  // Step 3: 論證策略 Step 產出
  claims: Claim[];                  // 雙方 claims（論證策略提取）
  sections: StrategySection[];      // 每段的論證框架

  // Step 4: Writer 逐段產出
  draftSections: DraftSection[];    // 每段含 content + citations
}

interface InformationGap {
  id: string;
  severity: 'critical' | 'nice_to_have';
  description: string;
  related_issue_id: string;
  suggestion: string;
}
```

### 11.3 核心方法

```typescript
class ContextStore {
  /** 取得所有指定方的 claims */
  getAllClaims(side: 'ours' | 'theirs'): Claim[] {
    return this.claims.filter(c => c.side === side);
  }

  /** 為特定段落組裝 Writer 需要的 context */
  getContextForSection(sectionIndex: number): WriterContext {
    const section = this.sections[sectionIndex];
    return {
      // 背景層
      caseSummary: this.caseSummary,
      briefType: this.briefType,
      fullOutline: this.sections.map(s => s.section),
      currentPosition: sectionIndex,

      // 焦點層（只放本段需要的）
      claims: this.claims.filter(c => section.claims.includes(c.id)),
      argumentation: section.argumentation,
      laws: this.research
        .flatMap(r => r.found_laws)
        .filter(l => section.relevant_law_ids.includes(l.id)),
      files: section.relevant_file_ids,
      factsToUse: section.facts_to_use,

      // 回顧層（全文傳入）
      completedSections: this.draftSections.slice(0, sectionIndex),
    };
  }

  /** 為品質審查組裝 context */
  getContextForReview(): ReviewContext {
    return {
      fullDraft: this.draftSections.map(d => d.content).join('\n\n'),
      legalIssues: this.legalIssues,
      allClaims: this.claims,
      allLaws: this.research.flatMap(r => r.found_laws),
      strategySections: this.sections,
      informationGaps: this.informationGaps,
    };
  }
}
```

---

## 12. 成本與效能估算

### 12.1 AI 呼叫次數

| Step | Model | 呼叫次數 | 預估 tokens |
|------|-------|---------|-------------|
| Orchestrator | Gemini Flash | 1 | ~2K in / ~1.5K out |
| 法律研究 Agent | Gemini Flash | 2-5（批次展開 + 補查） | ~1K in / ~500 out × N |
| 論證策略 | Claude | 1 | ~5K in / ~3K out（含 claims） |
| Writer | Claude Citations | N 段（5-8） | ~12-35K in / ~500 out × N |
| 品質審查（前檢） | 無（純程式） | 1 | 0 |
| 品質審查（LLM） | Claude | 1 | ~10K in / ~1K out |

### 12.2 vs 現在的成本比較

| | 現在 | v3 | 差異 |
|--|------|-----|------|
| Gemini calls | 0（pipeline 中） | ~5 | +5（便宜） |
| Claude calls | 1 Planner + N Writer | 1 論證 + N Writer + 1 審核 | +2 |
| MongoDB queries | N（Planner 決定） | 5-20（Agent 自主決定） | 變動 |
| 程式檢查 | 0 | 1（claims 前檢） | +1（免費） |
| 總時間 | ~30-60 秒 | ~40-80 秒 | +30-40% |
| 總成本 | ~NT$3-5 | ~NT$5-8 | +50-70% |

### 12.3 模型選擇原則

按**錯誤容忍度**分級：

| 容錯度 | 步驟 | 模型建議 |
|--------|------|---------|
| 低（錯了全盤皆輸） | 論證策略、Writer、品質審查 | Claude（最強模型） |
| 中（影響品質但不致命） | Orchestrator、法律研究攻防分析 | Gemini Flash，實測不足則升級 |
| 高（可容錯） | 結構化前檢 | 純程式，不需要 LLM |

---

## 13. 實作順序

### Phase 1a: 論證策略 Step + Writer Context 改善（後端）

> 優先實作的理由：能最快讓律師感受到書狀品質提升，不需要新的 agent 架構，開發風險最低。先跑通後端驗證品質，再處理前端 UI。

新增論證策略步驟，改善 Writer 的 context 組裝。

- 新增 `src/server/agent/prompts/strategistPrompt.ts`
- 實作 Context Store（集中管理步驟間資料流）
- 實作簡化版 Claim 結構（`statement` + `side` + `assigned_section`）
- 論證策略負責提取雙方 claims + 設計段落策略
- 論證策略 output validation + 帶錯誤訊息的 retry 機制
- 修改 Writer context 組裝：加入全局大綱、論證結構、claims 列表
- 已完成段落全文傳入（取消漸進壓縮）

### Phase 1b: 前端進度 UI 配合

- 更新 `pipeline_progress` SSE 事件格式以支援新的步驟類型（論證策略 Step）
- 調整前端進度顯示元件
- 確保新舊 pipeline 的 SSE 事件向後相容

### Phase 2: 法律研究 Agent

新增 `src/server/agent/researchAgent.ts`，替換現有的 `searchLawsForPlan`。

- 建立 Gemini tool loop（使用現有 callAIStreaming + parseOpenAIStream）
- 只有一個 tool: search_law
- 實作批次展開策略 + 按爭點計數停止條件
- 批次展開階段使用 `Promise.all` 平行搜尋 MongoDB，減少等待時間
- 停止條件包含 `has_defense_law_searched`：程式端維護 `searchedLawIds: Set<string>` 追蹤實際搜尋紀錄，而非只看 LLM output
- 與現有 briefPipeline 整合
- 進度 UI：顯示 Agent 正在搜尋什麼、找到什麼

### Phase 3: Orchestrator + 事實爭議管理 + 完整 Claim Graph

替換現有的 Step 1 為 Orchestrator，整合事實爭議分類。完善 claim graph。

- 新增 `src/server/agent/prompts/orchestratorPrompt.ts`
- Orchestrator output schema：`LegalIssue` 擴展既有 `Dispute` 格式（`{ id, title, our_position, their_position }` + `facts` + `key_evidence` + `mentioned_laws`），既有爭點作為種子傳入
- Orchestrator output 中的 `legal_issues` 不含 claims（不含 claims）+ information_gaps
- 事實分析邏輯抽成可複用函式（pipeline 內呼叫 + UI 獨立觸發）
- UI：Orchestrator 完成後立即推送事實全貌到 UI
- UI：事實爭議分類展示 + 律師手動修改介面
- 完善 claim graph：論證策略補充 `type`（attack/rebuttal）、`target`、`supported_by`
- information_gaps 傳遞至各下游步驟

### Phase 4: 品質審查

加入結構化前檢和 LLM 品質審核（僅回報）。

- 實作 `structuralPreCheck()`（基於 claims 的程式化檢查）
- 新增 `src/server/agent/prompts/reviewerPrompt.ts`
- 品質審查 input 包含論證策略 output + 前檢結果 + information_gaps
- 品質審查僅回報問題清單，不自動修正
- 對話層整合：AgentDO 根據 information_gaps + 審查結果告知使用者
- 進度 UI：顯示審核結果

### Phase 5（未來）: Few-shot 範例系統

待收集到律師認可的好段落後，加入依段落類型動態選擇的 few-shot 範例。

- 新增 `src/server/agent/prompts/examples/`
- 依段落類型分類（前言/反駁/損害賠償/結論）
- Writer context 加入示範層
- 需要真實的優質書狀段落作為範例，不使用 AI 生成的範例

### Phase 6（未來）: 自動修正迴圈

待 Phase 4 累積實際數據，確認「品質審查常抓到問題且修正有效」後再加入。

- 品質審查標記 critical 問題時自動重寫被標記段落
- 修正迴圈上限：最多 3 輪
- 降級策略：3 輪後仍有問題 → 輸出最佳版本 + 未解決問題清單

### Phase 7（未來）: 模板系統

待累積足夠書狀產出後，從中歸納書狀模板。

- 新增 `src/server/lib/briefTemplates.ts`
- 書狀骨架 lookup table
- 整合至論證策略 Step

---

## 14. 檔案結構

```
src/server/agent/
  ├── researchAgent.ts          ← Phase 2：法律研究 Agent（tool loop）
  ├── briefPipeline.ts          ← 修改：整合新架構
  ├── contextStore.ts           ← Phase 1：Context Store 集中管理
  ├── claimGraph.ts             ← Phase 3：完整 Claim 結構定義 + 操作方法
  ├── structuralPreCheck.ts     ← Phase 4：結構化前檢（純程式）
  ├── claudeClient.ts           ← 不變
  ├── aiClient.ts               ← 不變
  ├── prompts/
  │   ├── orchestratorPrompt.ts ← Phase 3（取代 plannerPrompt.ts）
  │   ├── strategistPrompt.ts   ← Phase 1a：論證策略 prompt
  │   ├── writerPrompt.ts       ← Phase 1a：Writer system prompt
  │   ├── reviewerPrompt.ts     ← Phase 4：品質審核 prompt
  │   └── examples/             ← Phase 5（未來）：依段落類型分類的 few-shot 範例
  └── tools/
      └── searchLaw.ts          ← 不變

src/server/lib/
  ├── lawConstants.ts           ← 已完成
  ├── lawSearch.ts              ← 已完成
  └── factAnalysis.ts           ← Phase 3：事實爭議分析（可複用函式）
```

---

## 附錄 A：容易踩的坑

| 坑 | 說明 | 對策 |
|----|------|------|
| 判例幻覺 | LLM 自己「想」判例字號是法律 AI 最常見的致命問題 | 一定要用搜尋系統，不讓模型自己編 |
| 法條搜不到就放棄 | 現狀最大的痛點 | Agent 批次展開 + 換關鍵字重試 |
| 書狀風格不一致 | 逐段撰寫時語氣斷裂 | 已完成段落全文傳入，不壓縮 |
| 忽略資訊缺口 | 資訊不足時模型腦補事實 | information_gaps 機制，pipeline 標記 + 對話層回饋 |
| 論證策略太細 | 策略寫到具體寫作指示，Writer 變翻譯機 | 策略管「用什麼牌」，Writer 管「怎麼表達」 |
| 品質審查沒有參照 | 審查員不知道原始策略，無法判斷是否偏離 | 品質審查 input 包含論證策略 output |
| 事實不分敵我 | 所有事實同等對待，不區分爭執/承認 | 事實爭議管理系統 |
| 對方主張漏回 | 只寫進攻不回防 | Claims 覆蓋檢查（程式前檢） |
| defense_risk 自我滿足 | LLM 只寫「對方可能主張」但沒搜尋 | 程式端 `searchedLawIds` 追蹤實際搜尋紀錄，停止條件比對此 Set 而非 LLM output |
| 單點故障 | 論證策略是單次 call，錯了全盤皆輸 | 程式端 output validation + 帶錯誤訊息的 retry + 品質審查雙重保障 |
| 格式不相容 | Orchestrator 和既有 Dispute 格式不同，需轉換 | `LegalIssue` 擴展既有 `Dispute` 格式（`{ id, title, our_position, their_position }`），下游直接使用 |
| Claim graph 過早精細化 | 要求 LLM 一次填完所有 ID 對應容易出錯 | Phase 1 簡化版先跑通，Phase 3 再加入精確對應 |

## 附錄 B：關鍵設計決策摘要

| 決策 | 選擇 | 理由 |
|------|------|------|
| 模板系統 | 暫不實作 | 由論證策略動態決定段落結構更靈活，累積產出後再歸納 |
| Orchestrator 產出推 UI | 立即推送，不阻擋 pipeline | 讓律師能早期發現問題，同時維持 vibe coding 模式 |
| 資訊不足的追問 | 對話層負責，非 pipeline 負責 | Pipeline 保持「有什麼用什麼」，追問責任移到 AgentDO |
| Claims 提取 | 論證策略負責，非 Orchestrator | Orchestrator 用 Flash 做資訊整合，claims 需要更強的推理能力（Claude），且需法律研究結果 |
| 品質審查 | 程式前檢 + LLM 審查（僅回報） | 結構問題用程式先抓，減少 LLM 負擔；先不自動修正，累積數據後再評估 |
| 實作順序 | 論證策略優先 | 最快產生書狀品質提升，開發風險最低 |
| 回顧層策略 | 全文傳入，不壓縮 | 200K context 足夠，壓縮反而丟失關鍵資訊 |
| 法律研究停止條件 | 程式端 `searchedLawIds` 追蹤 + 必須實際搜尋 defense_risk 法條 | 防止 LLM 自我滿足，程式端驗證而非依賴 LLM 自述 |
| 法律研究平行搜尋 | 批次展開階段 `Promise.all` 平行查詢 | 避免序列查詢累積延遲（6 條 × 500ms = 3s → ~500ms） |
| Claim graph 分階段 | Phase 1 簡化版（statement + side + assigned_section），Phase 3 補完整 | 降低 LLM ID 交叉引用出錯率，先驗證核心流程再逐步精細化 |
| 論證策略防護 | 程式端 output validation + 帶錯誤訊息的 retry | retry 時注入具體錯誤，LLM 能針對性修正而非盲目重試 |
| LegalIssue 格式 | 擴展既有 Dispute（`{ id, title, our_position, their_position }`） | 下游和 UI 無縫使用，不需格式轉換 |
| 事實分類簡化 | 不含 support_strength | assertion_type + source_side 可客觀萃取，support_strength 是主觀判斷且 Flash 分類信心不高 |
| Few-shot 範例 | 待收集真實優質範例後再加入 | AI 生成的範例品質不穩定，需要律師認可的真實段落 |
| 自動修正迴圈 | 待品質審查累積數據後再加入 | 每輪修正成本高（Claude call × N 段），需先確認 ROI |