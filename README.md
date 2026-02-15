# LexDraft - Sub-Agent Brief Writing Pipeline

## 現況問題

目前書狀撰寫由單一 AgentDO (Gemini 2.5 Flash) 在一個 conversation loop 中完成所有工作：

```
Gemini → list_files → Gemini → read_file → Gemini → read_file → Gemini
→ analyze_disputes → Gemini → search_law → Gemini → search_law → Gemini
→ create_brief → Gemini → write_brief_section → Gemini → write_brief_section → ...
```

### 痛點

1. **慢**：寫一份完整書狀需要 15-25 個 round trip，每次都等 Gemini 推理下一步
2. **Context 膨脹**：到第 15 round 時，conversation history 塞滿所有 tool results，後面段落品質下降
3. **法條搜尋是 sequential**：每個爭點的法條搜尋依序執行，無法平行
4. **單一 system prompt**：一份通用 prompt 同時指導分析、搜尋、寫作，每個任務的指引都不夠深入

---

## 新架構：write_full_brief Tool + Sub-Agents

新增一個 `write_full_brief` tool，Gemini 一次呼叫後，tool 內部自動跑完整個 pipeline。

pipeline 內部在需要 LLM 推理的步驟使用 sub-agent（獨立 LLM call + 專屬 prompt + focused context）。

Pipeline 全程接收 `AbortSignal`，每個步驟開始前檢查 `signal.aborted`。已透過 SSE 送出且存入 D1 的段落保留，僅停止後續撰寫。（沿用 AgentDO 現有的 AbortController + cancel endpoint。）

---

## Pipeline 四個步驟

### Step 1: 載入資料 + 建立書狀（程式，Promise.all）

不需要 LLM。平行載入資料並建立書狀：

| 資料         | 必要 | 來源                         | 說明                               |
| ------------ | :--: | ---------------------------- | ---------------------------------- |
| files[]      | 必要 | `loadReadyFiles()` 查 D1     | id, filename, summary, full_text   |
| disputes[]   | 必要 | D1 現有 / `analyzeDisputes`  | 如不存在則呼叫（內部 Gemini call） |
| damages[]    | 可選 | D1 現有 / `calculateDamages` | 僅在案件有金錢賠償主張時才計算     |
| **brief_id** | 必要 | `create_brief` 寫入 D1       | **在此步驟建立書狀**               |

**damages 為可選**：確認之訴（確認契約無效）、形成之訴（離婚、撤銷決議）、非金錢給付（返還房屋）等案件不涉及損害賠償。Pipeline 檢查 D1 是否有現有 damages，有則帶入，無則 `damages = null`，不強制呼叫 `calculateDamages`。

**create_brief 在 Step 1 執行**：Step 1 完成時立即送出 `brief_update (create_brief)` SSE event，使用者在 Planner 規劃期間就能看到 editor 出現，體感更流暢。brief_id 產生後供 Step 2-4 使用。

### Step 2: Planner Sub-Agent（Claude Haiku 4.5）

獨立 Claude call，專屬 system prompt，專注於書狀結構規劃。

**Input：檔案摘要（不傳 full_text）+ 爭點 + 損害（可選）**

Planner 只需要摘要來決定結構，不需要看合約原文的每一個條款。傳摘要讓它更聚焦、減少雜訊。damages 為 null 時 Planner 不會產出損害計算相關段落。

```
Input 範例（有損害賠償）：
┌─────────────────────────────────────────────────┐
│ 案件檔案摘要:                                     │
│   - 起訴狀.pdf: 原告主張被告侵權...                │
│   - 原證一.pdf: 契約書內容...                      │
│ 爭點:                                            │
│   - [d1] 侵權行為是否成立                          │
│   - [d2] 損害賠償範圍                              │
│ 損害: 貨款 500,000 + 利息 30,000 = 530,000        │
│ 書狀類型: preparation                             │
└─────────────────────────────────────────────────┘

Input 範例（無損害賠償，如確認之訴）：
┌─────────────────────────────────────────────────┐
│ 案件檔案摘要:                                     │
│   - 起訴狀.pdf: 原告請求確認契約無效...             │
│   - 原證一.pdf: 系爭契約書...                      │
│ 爭點:                                            │
│   - [d1] 契約是否因詐欺而得撤銷                    │
│   - [d2] 意思表示是否有瑕疵                        │
│ 損害: 無                                          │
│ 書狀類型: preparation                             │
└─────────────────────────────────────────────────┘
```

**Output：JSON 格式的書狀計畫**

```
Output 範例：
┌─────────────────────────────────────────────────┐
│ { sections: [                                    │
│   { section: "壹、前言",                          │
│     instruction: "簡述案件背景與訴訟標的",          │
│     relevant_file_ids: ["f1", "f2"],             │
│     search_queries: ["民事訴訟法第255條"] },       │
│   { section: "貳、反駁", subsection: "一、侵權行為",│
│     dispute_id: "d1",                            │
│     instruction: "反駁被告主張無故意過失...",        │
│     relevant_file_ids: ["f1", "f3"],             │
│     search_queries: ["民法第184條", "侵權舉證"] }, │
│   ...                                            │
│ ] }                                              │
│                                                  │
│ 錯誤處理：                                        │
│   JSON parse 失敗 → 重試 1 次                     │
│   重試仍失敗 → toolError() 回報錯誤               │
└─────────────────────────────────────────────────┘
```

**Planner Output 型別：**

```typescript
type BriefPlan = {
  brief_type: 'complaint' | 'defense' | 'preparation' | 'appeal';
  title: string;
  sections: SectionPlan[];
};

type SectionPlan = {
  section: string; // e.g. '壹、前言'
  subsection?: string; // e.g. '一、侵權行為'
  dispute_id?: string; // 對應的爭點 ID
  instruction: string; // 給 Writer 的寫作指示
  relevant_file_ids: string[]; // 該段需要引用的檔案
  search_queries: string[]; // 需要搜尋的法條關鍵字
};
```

### Step 3: 法條搜尋（程式，Promise.all）

收集 Planner 所有 sections 的 `search_queries`，去重後平行搜尋 MongoDB，再反向映射回每個 section。

```
去重 → ["民事訴訟法第255條", "民法第184條", "侵權舉證"]
         |                    |                |
         v                    v                v
    searchLaw()          searchLaw()      searchLaw()
    (MongoDB)            (MongoDB)        (MongoDB)
         |                    |                |
         v                    v                v
反向映射: section[0].laws = [民訴§255]
         section[1].laws = [民§184, 侵權舉證相關3條]

錯誤處理：某 query 回傳空結果 → 正常跳過，Writer 拿到空 laws 陣列
```

### Step 4: Writer Sub-Agent x N（Claude Haiku Citations）

每段各自呼叫 Claude Citations API，依序執行。

**每段 Writer 拿到的 context：**

| 資料              | 來源                                                    | 說明                                   |
| ----------------- | ------------------------------------------------------- | -------------------------------------- |
| 檔案 content_md   | Step 1 的 files，由 Planner 的 `relevant_file_ids` 篩選 | 優先用 content_md，fallback 到 full_text |
| 法條              | Step 3 搜尋結果，映射到該段                             | 法條內容作為 document 傳入             |
| 爭點資訊          | Step 1 的 disputes，由 `dispute_id` 對應                | 我方/對方立場                          |
| 前段全文          | 上一段 Writer 的完整輸出                                | 確保論證連貫                           |
| 撰寫指示          | Planner 的 `instruction`                                | 這段要寫什麼                           |

**檔案內容優先使用 content_md**：與現有 `writeBriefSection.ts` 邏輯一致，content_md（PDF 解析後的 markdown）結構更好、chunk 切割更準確。僅在 content_md 為空時 fallback 到 full_text。

**段間傳遞用全文，不用摘要：**

Haiku 成本極低（input $0.80/M tokens），整份書狀的段間傳遞成本差異不到 $0.03。傳全文可以確保段落間的論證邏輯連貫，不會因為壓縮而遺失重要資訊。

**Writer 每段的 Claude API call 結構：**

```
content: [
  { type: "document", ← 起訴狀.pdf content_md (Planner 指定) }
  { type: "document", ← 原證三.pdf content_md (Planner 指定) }
  { type: "document", ← 民§184 條文 (Step 3 搜到) }
  { type: "text",
    text: "爭點：侵權行為是否成立
          我方：被告有故意過失...
          對方：否認故意過失...
          前段內容：壹、前言（完整內容）...
          撰寫指示：反駁被告主張無故意過失..." }
]

Output: { text, segments, citations }
  → SSE: brief_update (add_paragraph)
  → SSE: brief_update (set_law_refs)

錯誤處理：單段 Claude call 失敗 → 記錄錯誤，跳過該段繼續，最後回報失敗段落
```

---

## 版本控管策略

Pipeline 一次寫多段，採用**整批一個版本**的策略：

- Pipeline 開始時 brief version +1（不是每段各 +1）
- 所有段落歸屬同一個 version，undo 時整批回退
- 避免產生大量中間版本，undo/redo 體驗一致

---

## 錯誤處理策略

Pipeline 有 4 個步驟，每步都可能失敗。MVP 包含以下錯誤處理：

| 失敗點                       | 處理方式                                            |
| ---------------------------- | --------------------------------------------------- |
| Step 1 載入資料失敗          | toolError() 回報錯誤，中止 pipeline                 |
| Planner JSON parse 失敗      | 重試 1 次，再失敗 toolError() 回報錯誤              |
| 法條搜尋某 query 回傳空結果  | 跳過該 query，Writer 在沒有法條的情況下先寫         |
| Writer 單段 Claude call 失敗 | 記錄錯誤，跳過該段繼續，最後回報失敗段落            |
| Pipeline 被取消 (AbortSignal) | 已送出的段落保留，停止後續撰寫，回報已完成段落數    |
| Pipeline 全面失敗            | 回傳有意義的錯誤訊息給 Gemini，由 Gemini 告知使用者 |

---

## Token 用量追蹤

Pipeline 內部的 Claude calls（Planner 1 次 + Writer N 次）需要累計 token 用量：

- `claudeClient.ts` 回傳時帶上 `usage: { input_tokens, output_tokens }`
- Pipeline 累計所有 Claude calls 的 usage
- Pipeline 完成後透過 `usage` SSE event 回報，與現有 Gemini token 追蹤合併顯示
- 使用者看到的 cost 包含 Gemini（1 round）+ Claude（N+1 calls）的總和

---

## Context 隔離設計

每個步驟只看到它需要的資料，避免 context 膨脹和雜訊干擾。

### 檔案資料的分流

```
                files (from D1)
               /              \
      summary (短)          content_md / full_text (長)
         |                      |
         v                      v
     Planner               Writer (每段)
 (只需要摘要來規劃)      (需要原文來寫作+引用)
```

### 段間傳遞

```
Writer 段落 1 完成
       |
  全文傳遞給下一段（Haiku 成本極低）
       |
       v
Writer 段落 2（拿到前段完整內容，確保論證連貫）
       |
      ...
       v
Writer 段落 N
```

### 各 Step 看得到什麼

| Step                     | 看得到                                                              | 看不到                                               |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------- |
| **Step 1** 載入資料      | D1 查詢結果                                                         | —                                                    |
| **Step 2** Planner       | 檔案**摘要** + 爭點 + 損害（如有）                                  | 檔案 full_text、法條、conversation history           |
| **Step 3** 法條搜尋      | Planner 的 search_queries                                           | 其他一切                                             |
| **Step 4** Writer (每段) | 該段的檔案 **content_md** + 該段法條 + 該段爭點 + **前段全文**       | 其他段落的檔案、其他段落的法條、conversation history |

---

## 觸發條件與操作路徑

`write_full_brief` 只在使用者要求撰寫「完整書狀」時觸發。其他操作沿用現有 tool，不受影響。

**Tool definition 需精確描述觸發時機**，避免 Gemini 與 `write_brief_section` 混淆：

```
使用時機：使用者明確要求撰寫一份完整書狀（如「幫我寫民事準備書狀」「撰寫答辯狀」）
不要用於：修改單段內容、補充法條引用、微調特定段落、回答法律問題
```

### 路徑對照表

| 操作           | 走哪條路                             | Gemini rounds |        Claude calls        | 改動            |
| -------------- | ------------------------------------ | :-----------: | :------------------------: | --------------- |
| 修改單段內容   | `write_brief_section`                |       1       |             1              | 不變            |
| 單段加指定法條 | `search_law` → `write_brief_section` |       2       |             1              | 不變            |
| 單段加模糊法條 | `search_law` → `write_brief_section` |       2       |             1              | 不變            |
| **寫完整書狀** | **`write_full_brief`（新）**         |     **1**     | **N+1 (Planner + Writer)** | **新 pipeline** |
| 全段落補法條   | 現有 sequential                      |     6-10      |             N              | 未來視需求      |

### 路徑 1：修改單段內容（不變）

> 使用者：「把前言改成更強調被告的過失」

```
Gemini → write_brief_section (paragraph_id, instruction)
       → Claude Citations API (UPDATE 模式)
       → SSE: brief_update → editor 更新
```

### 路徑 2：單段加法條引用（不變）

> 使用者：「幫前言加上民法 184 條」

```
Gemini → search_law("民法第184條") → 找到 [A0000001-第184條]
       → write_brief_section (paragraph_id, relevant_law_ids)
       → Claude Citations API (UPDATE 模式)
       → SSE: brief_update → editor + 法條面板更新
```

### 路徑 3：寫完整書狀（新 pipeline）

> 使用者：「幫我寫一份民事準備書狀」

```
Gemini → write_full_brief（1 個 Gemini round）
  Pipeline 內部：
  ├─ Step 1: 載入資料 + 建立書狀（Promise.all）
  │    → SSE: brief_update (create_brief) ← editor 立即出現
  ├─ Step 2: Planner 規劃結構（1 個 Claude call）
  ├─ Step 3: 法條搜尋（Promise.all）
  └─ Step 4: Writer 逐段撰寫（N 個 Claude call）
       → 每段完成即 SSE: brief_update (add_paragraph)
  最後：SSE: usage（Gemini + Claude 合計）
```

---

## 前端呈現

不需要新增 UI 元件。Pipeline 執行時沿用現有 SSE events：

- `tool_call_start` — 顯示「正在撰寫完整書狀...」
- `brief_update (create_brief)` — **Step 1 完成即觸發**，書狀建立，editor 出現
- `brief_update (set_disputes)` — 爭點面板更新（如果重新分析）
- `brief_update (set_law_refs)` — 法條面板更新
- `brief_update (add_paragraph)` — 每段寫完即時出現在 editor
- `tool_result` — 最終摘要（含失敗段落資訊，如有）
- `usage` — Gemini + Claude 合計 token 用量與成本

使用者體驗：點「寫書狀」後，editor 立即出現（Step 1），接著段落一段一段出現在右側 editor，跟現在一樣，只是更快。

---

## 程式碼變動

### 保留不動

- AgentDO 架構（Durable Object per case）
- 現有 8 個 tools（一般對話時照常使用）
- SSE streaming（brief_update events）
- 前端（不需要新 UI 元件）

### 新增

| 檔案                                        | 說明                       |
| ------------------------------------------- | -------------------------- |
| `src/server/agent/tools/writeFullBrief.ts`  | 新 tool，封裝整個 pipeline |
| `src/server/agent/briefPipeline.ts`         | pipeline 邏輯（Step 1-4）  |
| `src/server/agent/prompts/plannerPrompt.ts` | Planner 專屬 system prompt |

### 修改

| 檔案                                    | 說明                                                   |
| --------------------------------------- | ------------------------------------------------------ |
| `src/server/agent/tools/index.ts`       | 註冊新 tool                                            |
| `src/server/agent/tools/definitions.ts` | 新增 tool schema（含精確觸發時機描述 + 反例）          |
| `src/server/agent/claudeClient.ts`      | 回傳 `usage: { input_tokens, output_tokens }`          |
| AgentDO system prompt                   | 加入 `write_full_brief` 的使用時機說明                 |

---

## 預期效果

| 指標                        | 現在                       | 之後                                       |
| --------------------------- | -------------------------- | ------------------------------------------ |
| 寫書狀的 Gemini round trips | 15-25 次                   | 1 次（呼叫 tool）                          |
| Pipeline 內 LLM 呼叫        | 全部走 Gemini conversation | Claude Haiku（Planner 1 次 + Writer N 次） |
| 法條搜尋                    | sequential                 | parallel (Promise.all)                     |
| Writer context 大小         | 整個 conversation history  | 只有該段的爭點 + 法條 + 檔案 + 前段全文    |
| 書狀結構規劃                | Gemini 邊做邊想            | Planner 一次性規劃                         |
| 一般對話/單段修改           | 不影響                     | 不影響（走現有 tool）                      |
| 使用者體感                  | 等很久才看到 editor        | Step 1 完成即看到 editor                   |
| 取消支援                    | 無法中途取消               | AbortSignal，已寫段落保留                  |
| Token 用量                  | 只顯示 Gemini              | Gemini + Claude 合計                       |

---

## 未來改進項目

以下項目不在初版實作範圍內，視上線後使用情況決定是否推進。

### 1. Writer 段落平行化

在 `SectionPlan` 加入 `depends_on?: number[]`，讓 Planner 指定段落間的依賴關係。沒有依賴的段落可 Promise.all 平行撰寫，進一步加速。

### 2. 使用者確認書狀結構

Planner 產出計畫後，先透過 SSE 把結構計畫發給前端，讓律師可以調整（刪段、改順序、加指示）後確認，再開始 Step 3-4 撰寫。

### 3. Planner 模型升級

初版使用 Haiku 4.5。上線後觀察 plan 品質，若複雜案件的結構規劃不夠好，可升級 Planner 至 Sonnet 4.5（Writer 維持 Haiku，成本可控）。

### 4. 全段落批次補法條 Tool

新增 `update_brief_citations` tool，用類似 pipeline 方式平行搜尋所有段落的法條 + 依序更新。取代目前需要 6-10 個 Gemini round trips 的路徑。
