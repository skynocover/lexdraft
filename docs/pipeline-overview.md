# Brief Pipeline 流程總覽

> 最後更新：2026-03-05

## 架構概覽

```
用戶訊息 → AgentDO (Gemini 2.5 Flash) 多輪工具迴圈
                ↓ 決定呼叫 write_full_brief
          Brief Pipeline（4 步驟，依序執行）
          ├── Step 0: 案件分析
          ├── Step 1: 法條查詢
          ├── Step 2: 論證策略
          └── Step 3: 書狀撰寫
```

所有步驟透過 **ContextStore**（記憶體內）傳遞資料，透過 **SSE** 即時串流更新前端。

---

## 模型分配總表

| 階段                   | 模型                                           | 端點                                                | 用途                  |
| ---------------------- | ---------------------------------------------- | --------------------------------------------------- | --------------------- |
| AgentDO                | Gemini 2.5 Flash                               | AI Gateway compat                                   | 聊天 + 工具選擇       |
| Step 0a Case Reader    | Gemini 2.5 Flash                               | AI Gateway compat                                   | 案件閱讀              |
| Step 0b Issue Analyzer | Gemini 2.5 Flash                               | AI Gateway compat                                   | 爭點分析              |
| Step 1                 | —                                              | MongoDB                                             | 法條查詢（無 AI）     |
| Step 2a Reasoning      | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Claude API (tool-loop)                              | 法律推理 + search_law |
| Step 2b Structuring    | Gemini 2.5 Flash                               | Native endpoint (constrained decoding)              | JSON 結構化輸出       |
| Step 3 內容段落        | Claude Sonnet 4.6 (`claude-sonnet-4-6`)        | Claude Citations API                                | 書狀撰寫 + 引用標記   |
| Step 3 前言/結論       | Gemini 3.1 Flash Lite                          | OpenRouter (`google/gemini-3.1-flash-lite-preview`) | 前言結論撰寫          |

---

## 關鍵常數

| 常數                       | 值                          | 定義位置               | 說明                                 |
| -------------------------- | --------------------------- | ---------------------- | ------------------------------------ |
| `CLAUDE_MODEL`             | `claude-haiku-4-5-20251001` | `strategyConstants.ts` | Step 2a 推理模型                     |
| `MAX_ROUNDS`               | 6                           | `strategyConstants.ts` | Step 2a 最大工具迴圈輪數             |
| `MAX_SEARCHES`             | 6                           | `strategyConstants.ts` | Step 2a 最大 search_law 次數         |
| `SOFT_TIMEOUT_MS`          | 25000 (25s)                 | `strategyConstants.ts` | Step 2a 超時後催促 finalize          |
| `MAX_TOKENS`               | 8192                        | `strategyConstants.ts` | Step 2a Claude 推理 max_tokens       |
| `JSON_OUTPUT_MAX_TOKENS`   | 32768                       | `strategyConstants.ts` | Step 2b Gemini 結構化 max_tokens     |
| `TOOL_RESULT_MAX_CHARS`    | 200                         | `strategyConstants.ts` | Step 2a 壓縮舊 tool_result 截斷長度  |
| `MAX_LAW_CONTENT_LENGTH`   | 600                         | `lawFetchStep.ts`      | Step 1 法條截斷長度（給 Step 2 用）  |
| `CITATIONS_MODEL`          | `claude-sonnet-4-6`         | `claudeClient.ts`      | Step 3 內容段落 Citations API        |
| `PLANNER_MODEL`            | `claude-haiku-4-5-20251001` | `claudeClient.ts`      | 備用（Planner sub-agent）            |
| Citations max_tokens       | 4096                        | `claudeClient.ts`      | Step 3 Citations API 單段 max_tokens |
| Intro/conclusion maxTokens | 2048                        | `writerStep.ts`        | Step 3 前言/結論 max_tokens          |

---

## AgentDO — 最外層 Orchestrator

**檔案**: `src/server/durable-objects/AgentDO.ts`

- **模型**: Gemini 2.5 Flash（AI Gateway compat endpoint）
- **機制**: 多輪 tool-calling loop（最多 30 輪）
- **可用工具**: `list_files`, `read_file`, `create_brief`, `write_brief_section`, `write_full_brief`, `analyze_disputes`, `calculate_damages`, `search_law`, `generate_timeline`, `review_brief`

**流程**:

1. 載入該 case 的對話歷史
2. 組裝 system prompt + 歷史 → 呼叫 Gemini
3. 解析 SSE stream，收集文字 + tool calls
4. 若有 tool calls → 逐一執行 → 收集結果 → 回到步驟 2
5. 若無 tool calls → 生成 suggested actions → 結束

**特殊行為**:

- 編輯既有書狀時，注入書狀標題 + 段落結構到 system prompt
- 結束後用 Gemini 生成 2-3 個建議操作（JSON 格式）
- 支援 AbortController 取消

---

## Step 0: 案件分析

**檔案**: `src/server/agent/pipeline/caseAnalysisStep.ts`

### 初始化

並行 DB 查詢：files、disputes、damages、case row、law refs

### 三路並行處理

Disputes、Damages、Timeline 用 `Promise.all` 同時執行：

#### 0a — Case Reader（Gemini 2.5 Flash, 多輪工具迴圈）

|            |                                                        |
| ---------- | ------------------------------------------------------ |
| **輸入**   | 已就緒檔案列表（含摘要）、案件 metadata                |
| **做的事** | AI 讀取 2-6 份文件，提取關鍵事實、涉及法條、主張、金額 |
| **輸出**   | `caseSummary`, `parties`, `fileNotes[]`                |

#### 0b — Issue Analyzer（Gemini 2.5 Flash, 單次呼叫）

|            |                                                                          |
| ---------- | ------------------------------------------------------------------------ |
| **輸入**   | 0a 的輸出                                                                |
| **做的事** | 辨識法律爭點、提取事實（主張/承認/爭執等）、找資訊缺口                   |
| **輸出**   | `legalIssues[]`（含爭點、雙方立場、證據、涉及法條）、`informationGaps[]` |

### 快取邏輯

- DB 已有 disputes 且有內容 → 跳過 AI 分析，直接重用
- Orchestrator 失敗 → fallback 到 `analyze_disputes` 工具

### Template 載入

- `auto` → `autoSelectTemplate(briefType)` 自動選擇
- `default-*` → 內建模板 `DEFAULT_TEMPLATES`
- 其他 → DB 查詢自訂模板

### 輸出

存 disputes/timeline/damages 到 D1，SSE 推送 `set_disputes`, `set_parties`, `set_timeline`，填入 ContextStore。

---

## Step 1: 法條查詢

**檔案**: `src/server/agent/pipeline/lawFetchStep.ts`

**純函式，無 AI 呼叫。**

|            |                                                                                  |
| ---------- | -------------------------------------------------------------------------------- |
| **輸入**   | Step 0 `legalIssues[].mentioned_laws`（如 "民法第184條"）、用戶手動法條、DB 快取 |
| **做的事** | 正規化法條名 → PCODE_MAP 對應 → MongoDB 批次查詢 → 加伴隨法條 → 跳過已快取       |
| **輸出**   | `Map<string, FetchedLaw>`（法條 ID → 內容）                                      |

### 截斷策略

- 法條內容截斷至 **600 字**給 Step 2（節省 token）
- **全文**存 DB 給 Step 3 使用

### 處理順序

1. 正規化：`"民法第184條"` → `{lawName: "中華民國民法", articleNo: "184"}`
2. 展開伴隨法條（如 184 → 也查 184-1, 184-2）
3. MongoDB 批次查詢（by canonical `_id`）
4. 未命中的 → 個別 text search fallback
5. 合併用戶手動法條
6. 跳過已在 DB 快取的法條

---

## Step 2: 論證策略

**檔案**: `src/server/agent/pipeline/reasoningStrategyStep.ts`

### Phase A — Legal Reasoning（Claude Haiku 4.5, 多輪工具迴圈）

|            |                                                                                       |
| ---------- | ------------------------------------------------------------------------------------- |
| **輸入**   | 案件摘要、爭點+事實、截斷法條(600字)、損害賠償、時間軸、檔案摘要、用戶手動法條        |
| **做的事** | AI 自由推理法律策略，可呼叫 `search_law` 補充法條，完成後呼叫 `finalize_strategy`     |
| **輸出**   | `reasoning_summary` + `per_issue_analysis`（每爭點的法律依據、要件映射、key_law_ids） |

**可用工具**:

- `search_law` — 查 MongoDB 補充法條（最多 6 次）
- `finalize_strategy` — 結束推理，輸出摘要 + per-issue 分析

**機制**:

- **Prompt caching**: system prompt + 最後一個 tool 加 `cache_control: { type: 'ephemeral' }`
- **Soft timeout**: 25 秒後催促 Claude finalize
- **工具結果壓縮**: 舊 `search_law` 結果替換為 ≤200 字摘要（省 token）
- **Max rounds**: 6 輪，超過強制 finalize

### Phase B — JSON Structure Output（Gemini 2.5 Flash Native, constrained decoding）

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| **輸入**   | Phase A 推理摘要 + per_issue_analysis + 所有可用法條 + 爭點 + 檔案列表 |
| **做的事** | `responseSchema` 強制 JSON 格式，產生 claims 圖譜 + 段落結構           |
| **輸出**   | `claims[]`, `sections[]`                                               |

**Template 感知**:

- 有 template → system prompt 注入完整 markdown 範本
- 無 template → 注入 briefType 的 fallback 結構指引

**輸出結構**:

```typescript
claims: [{
  id, side: 'ours'|'theirs',
  claim_type: 'primary'|'rebuttal'|'supporting',
  statement, assigned_section, dispute_id, responds_to
}]

sections: [{
  id, section, subsection, dispute_id,
  claims: string[],              // claim IDs
  relevant_file_ids: string[],
  relevant_law_ids: string[],
  facts_to_use: FactUsage[],
  legal_reasoning: string,
  argumentation: {
    legal_basis: string[],
    fact_application: string,
    conclusion: string
  }
}]
```

完成後：claims 寫入 D1（批次 10 筆），strategy 存入 ContextStore。

---

## Step 3: 書狀撰寫

**檔案**: `src/server/agent/pipeline/writerStep.ts`

**逐段依序生成**（後面段落需要前面段落全文作為 review context，無法並行）

### 路由決策

```typescript
const isIntroOrConclusion = !strategySection.dispute_id;
```

| 類型      | 模型                  | 端點          | max_tokens | 特色                  |
| --------- | --------------------- | ------------- | ---------- | --------------------- |
| 內容段落  | Claude Sonnet 4.6     | Citations API | 4096       | 自動標記法條+檔案引用 |
| 前言/結論 | Gemini 3.1 Flash Lite | OpenRouter    | 2048       | 純文字，無引用        |

### 每段輸入 — 3 層 Context

| 層             | 內容                                                                           | 目的               |
| -------------- | ------------------------------------------------------------------------------ | ------------------ |
| **Background** | 完整大綱 + 標記「你正在寫這段」+ 案件摘要 + brief type                         | 全局意識           |
| **Focus**      | assigned claims + argumentation framework + 法條全文 + 檔案原文 + facts_to_use | 專注當前段落       |
| **Review**     | 所有已完成段落全文                                                             | 前後一致、避免重複 |

### 內容段落（Claude Sonnet + Citations）

1. 組裝 `ClaudeDocument[]`：法條 + 檔案原文（按 `##` 或 `。` 切 chunk）
2. 呼叫 `callClaudeWithCitations()` → Claude 自動標記引用
3. `stripLeadingHeadings()` — 去除 Claude 加的重複標題
4. `stripMarkdown()` — 移除 markdown 格式
5. `rebuildSegmentsAfterStrip()` — 重建 segment offsets

### 前言/結論（Gemini Flash Lite）

1. 簡單 system prompt：「你是台灣資深訴訟律師，撰寫法律書狀段落」
2. `callOpenRouterText()` → 純文字輸出
3. `stripMarkdown()` → 移除格式

### 輸出（per paragraph）

```typescript
{
  id: string,
  section: string,
  subsection: string,
  content_md: string,
  segments: TextSegment[],
  citations: Citation[],
  dispute_id: string | null
}
```

### 後處理

- `fetchAndCacheUncitedMentions()` — 偵測文中提到但未被 Citations API 引用的法條，補查 MongoDB 存入 DB
- `cleanupUncitedLaws()` — 移除最終未被引用且非手動加入的法條

完成後：批次更新 DB，建立 `brief_versions` 快照。

---

## ContextStore 資料流

**檔案**: `src/server/agent/contextStore.ts`

記憶體內資料中心，pipeline 執行期間存活，結束後 GC。

### 各步驟寫入

| 步驟    | 寫入的資料                                                                                |
| ------- | ----------------------------------------------------------------------------------------- |
| Step 0  | `caseSummary`, `parties`, `legalIssues[]`, `damages[]`, `timeline[]`, `informationGaps[]` |
| Step 1  | `foundLaws` (Map)                                                                         |
| Step 2a | `reasoningSummary`, `perIssueAnalysis[]`, `supplementedLaws[]`                            |
| Step 2b | `claims[]`, `sections[]`                                                                  |
| Step 3  | `draftSections[]`（逐段累積）                                                             |

### 關鍵查詢方法

| 方法                             | 說明                         |
| -------------------------------- | ---------------------------- |
| `resolveLawsForSection(i)`       | 3-tier 法條 fallback（見下） |
| `getContextForSection(i)`        | 組裝 3 層 writer context     |
| `getUnrebutted()`                | 找未被反駁的對方主張         |
| `serialize()` / `fromSnapshot()` | 快照存取（測試用）           |

### 3-Tier 法條 Fallback（`resolveLawsForSection`）

1. **Tier 1**: `relevant_law_ids` 有值 → 使用 enrichment 結果
2. **Tier 2**: 空 + 有 `dispute_id` → 從 `perIssueAnalysis.key_law_ids` 推導
3. **Tier 3**: 有 `dispute_id` 但 Tier 1+2 空 → ALL found laws（安全網）；`dispute_id=null`（前言/結論）→ 空陣列

---

## SSE 事件

| 事件                                | 說明                                   |
| ----------------------------------- | -------------------------------------- |
| `pipeline_progress`                 | 步驟進度 `{steps, durationMs, detail}` |
| `brief_update:set_disputes`         | 爭點載入                               |
| `brief_update:set_parties`          | 當事人                                 |
| `brief_update:set_timeline`         | 時間軸                                 |
| `brief_update:set_claims`           | Claims 圖譜                            |
| `brief_update:add_paragraph`        | 新段落寫完                             |
| `brief_update:set_law_refs`         | 法條更新                               |
| `pipeline_timing`                   | 總執行時間                             |
| `text_delta`                        | Agent 串流文字                         |
| `tool_call_start` / `tool_call_end` | 工具執行標記                           |
