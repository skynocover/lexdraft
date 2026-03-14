# 爭點分析 — 影響因素全覽

> 最後更新：2026-03-14

```
┌─────────────────────────────────────────────────┐
│                 用戶直接控制的                      │
└─────────┬──────────┬──────────┬─────────────────┘
          │          │          │
          ▼          ▼          ▼
    clientRole    上傳的檔案    caseInstructions
    (plaintiff/   (PDF →       (自由文字指示)
     defendant)    全文 + 摘要)
          │          │          │
          │          ▼          │
          │   ┌──────────┐     │
          │   │fileProcessor│   │
          │   │ (Gemini   │    │
          │   │  Flash    │    │
          │   │  Lite)    │    │
          │   └────┬─────┘     │
          │        │           │
          │        ▼           │
          │   5 個衍生欄位：     │
          │   full_text        │
          │   content_md       │
          │   summary          │
          │   category         │
          │    (brief/         │
          │     exhibit_a/b)   │
          │   doc_date         │
          │        │           │
          ▼        ▼           ▼
    ┌──────────────────────────────────────┐
    │   還有這些也會注入 prompt：              │
    │                                      │
    │   - 填寫的當事人（原告/被告姓名）        │
    │   - 案號、法院、股別                    │
    │   - templateTitle（書狀名稱）           │
    └──────────────────┬───────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  既有爭點閘門    │
              │  (DB 已有爭點    │
              │   且有立場？)    │
              └───┬────────┬───┘
               有 │        │ 無
                  ▼        ▼
           直接沿用    進入 AI 分析
           ─ 結束 ─    ─ 往下 ─
```

---

## 按 pipeline 步驟，每一步有什麼影響產出

### Stage 1：Case Reader（案件閱讀）

```
模型：Gemini 2.5 Flash（AI Gateway compat, streaming）
常數：MAX_AGENT_ROUNDS = 8, MAX_FILE_READS = 6, TIMEOUT = 90s
```

```
輸入因素                          產出（傳給 Stage 2）
─────────────────────            ─────────────────────

readyFiles                       ┐
  只有 summary 非空的檔案才進入     │
  category 決定閱讀優先順序         │
  (brief > exhibit > other)      │
                                 │
full_text                        ├──→  fileNotes[]（核心中間表示）
  read_file 截斷至 15,000 字      │     每份檔案拆解為：
  重複讀取被阻擋                   │       key_facts[]
  最多讀 6 份全文                  │       mentioned_laws[]
                                 │       claims[]
summary                          │       key_amounts[]
  未讀取的檔案只看 summary         │
                                 ┘
existingParties                  ──→  parties（原告/被告）
  (plaintiff / defendant)              LLM 抽取不到 → fallback 用 DB 值

caseMetadata                     ──→  caseSummary（≤500 字）
  (案號/法院/股別/clientRole)

templateTitle
  注入 [書狀名稱]

caseInstructions
  注入 [律師處理指引]
```

```
                    fileNotes
                        │
                  formatFileNotes()
                        │
                        ▼
          ┌──────────────────────────┐
          │ 【起訴狀.pdf】              │
          │ 關鍵事實：                  │
          │   - 事實1                  │
          │   - 事實2                  │
          │ 提及法條：民法第184條、...    │
          │ 各方主張：                  │
          │   - 原告主張...             │
          │   - 被告主張...             │
          │ 關鍵金額：醫療費15萬、...     │
          └──────────────────────────┘
          這是 Issue Analyzer 唯一看到的「證據」
```

**品質關鍵**：FileNote 的結構化拆解迫使 LLM 先做資訊萃取。
合併版測試（2026-03-11）證實：跳過此步直接讓 LLM 看原文 → 爭點從 5 降到 2~3。

---

### Stage 2：Issue Analyzer（爭點分析）

```
模型：Gemini 2.5 Flash（AI Gateway compat, 非 streaming）
常數：maxTokens = 16384, temperature = 0, TIMEOUT = 60s
```

```
輸入因素                          產出（最終結果）
─────────────────────            ─────────────────────

caseSummary（≤500字）             ┐
                                 │
parties（原告/被告）              ├──→  legalIssues[]
                                 │     每個爭點包含：
fileNotes（格式化文字）            │       title（問句格式）
  = formatFileNotes() 的輸出      │       our_position
                                 │       their_position
clientRole                       │       key_evidence[]
  → 決定 our / their 的方向       │       mentioned_laws[]
                                 │
templateTitle                    ├──→  undisputedFacts[]
  注入 [書狀名稱]                 │     每項不爭執事實
                                 │
caseInstructions                 ├──→  informationGaps[]
  注入 [律師處理指引]              │     缺少的資訊
                                 ┘
```

```
System Prompt 中的規則（直接控制「什麼算爭點」）：

┌─────────────────────────────────────────────────┐
│  爭點判定三分類                                    │
│                                                  │
│  憑證型金額（醫療費、交通費、修車費）                 │
│  → 除非對方質疑單據，否則 ✗ 不是爭點                │
│                                                  │
│  裁量型金額（精神慰撫金、不能工作期間、過失比例）      │
│  → 即使對方未反駁，✓ 一律是爭點                     │
│                                                  │
│  一般議題（過失責任、因果關係）                       │
│  → 對方有具體反駁 → ✓ 爭點                         │
│  → 對方僅概括否認 → ✗ 不是爭點                      │
├─────────────────────────────────────────────────┤
│  不爭執事項排除規則                                 │
│                                                  │
│  ✗ 程序性事項（調解不成立、送達）                    │
│  ✗ 調解細節（金額、讓步）                           │
│  ✗ 背景描述（天候、路面），除非影響過失               │
│  ✗ 具體賠償金額（屬 damages 處理）                  │
│  ✓ 影響計算的基礎事實（月薪、住院天數）              │
├─────────────────────────────────────────────────┤
│  格式要求                                         │
│                                                  │
│  title → 法院爭點整理問句格式                       │
│  our/their_position → 須含人事時地金額              │
│  mentioned_laws → 只填 FileNote 明確列出的法條       │
└─────────────────────────────────────────────────┘
```

---

### Stage 2→3 銜接：清理 + 平行寫入

```
不是 AI 呼叫，是 DB 操作。全量覆蓋，不是增量更新。
```

```
Phase 1（平行）：清理舊資料 + 寫入不依賴後續步驟的欄位
─────────────────────────────────────────────────
  刪除舊 damages                ← FK ordering，必須先刪
  刪除舊 disputes
  寫入 information_gaps         ← 不受 dedup 影響，可以先寫
  partyUpdate                   ← AI 抽取的原告/被告只在 DB 為空時寫入

Phase 2（平行）：插入新 disputes + Stage 3 金額分析同時進行
─────────────────────────────────────────────────
  insertDisputes()              ← 批量寫入（每 10 筆）
        ║
  runDamagesWithDisputes()      ← 平行（只需 in-memory disputeList）
```

---

### Stage 3：Damages Analysis（金額分析）

```
模型：Gemini 2.5 Flash（Native endpoint, constrained decoding）
常數：maxTokens = 8192, temperature = 0, thinkingBudget = 0
```

```
輸入因素                          產出
─────────────────────            ─────────────────────

fileContext                      ┐
  = 所有 ready 檔案的              │
    filename + summary            │
    拼成的文字                     │
                                 │
fileNotes[].key_amounts          ├──→  damages[]
  = Stage 1 Case Reader 提取的    │     每筆金額包含：
    結構化金額明細                  │       category（財產/非財產上損害）
  注入為 [檔案金額明細] 區塊        │       description
                                 │       amount（整數，新台幣元）
disputeList                      │       basis（計算依據明細）
  = Stage 2 的 legalIssues       │       dispute_id（關聯到哪個爭點）
    [{id, number, title}]        │       evidence_refs[]（來源檔案名）
                                 ┘
```

```
Prompt 核心要求：

┌─────────────────────────────────────────────────┐
│  為每筆金額指定 dispute_id                         │
│  → 填入最相關的爭點 id                             │
│  → 一個爭點可以對應多筆金額                         │
│  → 不屬於任何爭點 → dispute_id = null              │
├─────────────────────────────────────────────────┤
│  dispute_id 驗證（code 層）                        │
│  → LLM 給的 id 不在 disputeList 中 → 設為 null    │
│  → 防止 LLM 幻覺產生不存在的 id                     │
└─────────────────────────────────────────────────┘
```

---

### Post-processing（後處理）

```
Stage 3 產出
        │
        ▼
  deduplicateUndisputedFacts()
  ─ 移除與 damages 金額+描述重疊的不爭執事項
  ─ 判定條件：NT$ 金額 regex 匹配 AND 描述 substring 重疊
  ─ 目的：金額歸 damages 表管，不重複出現在不爭執事項
        │
        ▼
  寫入 cases.undisputed_facts（dedup 後只寫一次）
        │
        ▼
  SSE 推送 4 個事件到前端：
    set_disputes
    set_undisputed_facts
    set_information_gaps
    set_parties
```

---

## 影響力排序

```
高｜ clientRole          — 錯了所有 our/their 立場都反轉
  ｜ 上傳的檔案品質       — 沒有/不完整的檔案 → Case Reader 無料可讀
  ｜ Issue Analyzer prompt — 三分類規則直接決定什麼算爭點
  ｜ FileNote 結構化拆解   — 品質核心，拿掉就降到 2-3 個爭點
  ｜ Case Reader 讀檔上限  — MAX_FILE_READS=6，遺漏關鍵文件就漏爭點
  ｜ caseInstructions     — 律師指引可引導分析方向
  ｜ 既有爭點閘門         — DB 有爭點就完全跳過 AI
  ｜ temperature=0        — 確保 Issue Analyzer 輸出穩定
  ｜ 不爭執事項排除規則    — 防止雜訊進入不爭執事項
  ｜ 不爭執事項去重       — 移除與 damages 重疊的項目
低｜ 當事人覆蓋保護       — 防止 AI 覆蓋手動值（安全閥）
```

---

## 關鍵檔案索引

| 檔案                    | 內容                                                      |
| ----------------------- | --------------------------------------------------------- |
| `orchestratorPrompt.ts` | 兩份 system prompt + user message builder + FileNote 型別 |
| `orchestratorAgent.ts`  | Case Reader 迴圈 + Issue Analyzer 呼叫 + output parsing   |
| `analysisService.ts`    | `runDeepDisputeAnalysis` + dedup + persist                |
| `caseAnalysisStep.ts`   | 既有爭點閘門 + DB 查詢 + SSE dispatch                     |
| `toolHelpers.ts`        | `loadReadyFiles` + `buildFileContext`                     |
| `aiClient.ts`           | `callAIStreaming` / `callAI` + model 常數                 |
| `promptHelpers.ts`      | `buildCaseMetaLines` + `buildInstructionsBlock`           |
| `fileProcessor.ts`      | 檔案處理 + 分類 + summary 產生                            |
