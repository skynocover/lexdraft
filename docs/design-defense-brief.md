# 答辯狀 Flow 設計文件

> 目標：讓 LexDraft 支援民事答辯狀（及準備書狀），覆蓋台灣訴訟中約一半的書狀場景。

---

## 背景：起訴狀 vs 答辯狀的根本差異

```
起訴狀思路（目前的 pipeline）：        答辯狀思路（需要新增）：

我的事實 → 建構請求權基礎              對方主張了什麼 → 逐點回應
     ↓                                      ↓
爭點由我定義                            爭點由對方定義
     ↓                                      ↓
我選擇論證順序                          順序跟著對方走
     ↓                                      ↓
主動攻擊                                被動防禦 + 反擊
```

### 台灣訴訟書狀的時間線

```
原告提起訴訟
  └→ 起訴狀 (complaint)         ← 模式 A（目前支援）
       ↓
被告收到起訴狀繕本
  └→ 答辯狀 (defense)           ← 模式 B（本文件）
       ↓
雙方交換書狀
  └→ 準備書狀 (preparation)     ← 模式 B（共用 flow）
       ↓
一審判決
  └→ 上訴理由狀 (appeal)        ← 模式 C（未來）
```

**關鍵設計原則：同一案件可能有多份書狀（起訴狀 → 答辯狀 → 準備書狀），共用相同的爭點定義，但論證方向不同。**

---

## 現有基礎盤點

### 已經有的（不需要重建）

| 項目 | 位置 | 說明 |
|------|------|------|
| 答辯狀模板 | `defaultTemplates.ts` → `default-civil-defense` | 壹答辯聲明、貳前言、參事實及理由、肆結論、伍證據方法 |
| 準備書狀模板 | `defaultTemplates.ts` → `default-civil-preparation` | 已存在 |
| 雙方立場 | `disputes` 表 | 每個爭點有 `our_position` + `their_position` |
| Claims 攻防結構 | `claims` 表 | `side: 'ours'|'theirs'`、`claim_type: 'primary'|'rebuttal'|'supporting'` |
| 檔案分類 | `fileProcessor.ts` | 依 `clientRole` 自動分類 `exhibit_a`/`exhibit_b` |
| 案型知識庫 defendant guidance | `caseTypes/*.ts` | 6 個案型的被告視角已有 |
| `client_role` 欄位 | `cases` 表 | 區分原告/被告 |

### 需要新增或修改的

| 項目 | 位置 | 變更類型 |
|------|------|---------|
| `brief_type` 欄位 | `schema.ts` briefs 表 | DB migration |
| `brief_type` 參數 | `writeFullBrief.ts` tool handler | 新增參數 |
| Step 0 分支邏輯 | `caseAnalysisStep.ts` | 答辯狀跳過 orchestrator，複用已有爭點 |
| Step 2 推理 prompt | `reasoningStrategyPrompt.ts` | 新增答辯狀版本的 system prompt |
| Step 2 策略常數 | `strategyConstants.ts` | 新增答辯狀的結構規則 |
| Step 3 Writer prompt | `writerStep.ts` | 答辯狀的段落寫作指令 |
| Zod schema | `schemas/tools.ts` | `writeFullBriefArgsSchema` 加 `brief_type` |
| 前端 | brief 建立 UI | 選擇書狀類型 |

---

## DB Schema 變更

### 新增 `brief_type` 欄位

```typescript
// schema.ts
export const briefs = sqliteTable('briefs', {
  // ... 現有欄位
  brief_type: text('brief_type').default('complaint'),
  // 值：'complaint' | 'defense' | 'preparation' | 'appeal'
});
```

需要 Drizzle migration：
```bash
npm run db:generate
npm run db:migrate:local
```

---

## Pipeline 變更：逐 Step 說明

### Step 0：案件分析 — 答辯狀跳過 orchestrator

**核心邏輯：** 答辯狀建立時，案件的爭點/損害/時間軸應該已經存在（從起訴狀分析時產生）。

```
if (brief_type === 'complaint') {
  // 現有邏輯：跑 Case Reader + Issue Analyzer（完整分析）
} else {
  // 答辯狀/準備書狀：
  // 1. 載入現有 disputes、damages、timeline（必須已存在）
  // 2. 如果不存在 → 報錯，提示用戶先分析案件
  // 3. 跳過 orchestrator agents
  // 4. 直接 seed ContextStore
}
```

`caseAnalysisStep.ts` 目前已有 `existingDisputes` 的複用邏輯（約 line 203-246），答辯狀走這條路徑。

**額外處理：** 如果有新上傳的「對方書狀」檔案（`category: 'brief'`），需要特別處理：
- 用 Document Parser 解析對方書狀的逐段主張
- 這些主張對應到已有的 disputes 或新增 disputes

### Step 1：法條查詢 — 無變更

法條查詢是純函式，不受 brief_type 影響。answers 狀需要的法條跟起訴狀重疊度高，新法條會在 Step 2 reasoning 中透過 `search_law` 補充。

### Step 2：推理 + 策略 — 核心變更

#### Phase A：Claude Haiku Reasoning

**需要新的 system prompt（答辯狀版本）：**

起訴狀版本的重點：
- 選擇請求權基礎
- 要件涵攝
- 預測對方抗辯

答辯狀版本的重點：
- **逐點回應對方主張**：否認 / 不知 / 爭執分類
- **舉證責任分析**：哪些事實應由原告舉證
- **積極防禦**：時效抗辯、過失相抵、損益相抵等
- **反擊策略**：哪些點可以主動攻擊

```
// reasoningStrategyPrompt.ts
// 新增函式：
export const buildDefenseReasoningPrompt = (input) => {
  // System prompt 強調：
  // 1. 你是被告方律師，正在撰寫答辯狀
  // 2. 逐一檢視原告的每個主張
  // 3. 對每個主張做「否認/不知/爭執」分類
  // 4. 找出原告的舉證弱點
  // 5. 列出可用的積極防禦（時效、過失相抵等）
}
```

#### Phase B：Gemini JSON 結構化

**輸出結構的差異：**

起訴狀的 sections 結構：
```
壹、前言
貳、事實及理由
  一、（爭點1的論述）
  二、（爭點2的論述）
參、結論
```

答辯狀的 sections 結構：
```
壹、答辯聲明
貳、前言
參、事實及理由
  一、（對原告主張1的回應）
  二、（對原告主張2的回應）
  三、（我方積極抗辯）
肆、結論
```

**Claims 結構的差異：**

起訴狀：
- `ours` claims 多為 `primary`（主動主張）
- `theirs` claims 多為假設的對方反駁

答辯狀：
- `theirs` claims = 原告的主張（已知，從起訴狀解析）
- `ours` claims 多為 `rebuttal`（回應原告）+ 少數 `primary`（積極抗辯）
- 每個 `rebuttal` 都有 `responds_to` 指向原告的 claim

**strategyConstants.ts 新增：**

```typescript
export const DEFENSE_SECTION_RULES = `
## 答辯狀段落結構規則

1. 第一段必須是「壹、答辯聲明」— 明確表示駁回原告之訴
2. 第二段是「貳、前言」— 簡述案件背景和答辯立場
3. 中間段落跟著原告的主張走，逐點回應
4. 每個中間段落必須：
   - 明確標示在回應原告的哪個主張
   - 分類為「否認」「不知」或「爭執」
   - 提出反駁理由和證據
5. 如有積極抗辯（時效、過失相抵等），放在回應段落之後、結論之前
6. 最末段是結論，重述答辯聲明
`;

export const DEFENSE_CLAIMS_RULES = `
## 答辯狀主張規則

- theirs (primary): 原告的各項主張（從起訴狀/爭點中已知）
- ours (rebuttal): 針對原告各主張的回應，必須有 responds_to
- ours (primary): 被告的積極抗辯（時效、過失相抵等），不需要 responds_to
- ours (supporting): 補強 rebuttal 的附帶論述
`;
```

### Step 3：Writer — prompt 調整

答辯狀的寫作風格跟起訴狀不同：

| 面向 | 起訴狀 | 答辯狀 |
|------|--------|--------|
| 語氣 | 主動攻擊 | 防禦 + 反擊 |
| 結構 | 「按...查...」建構論證 | 「原告主張...惟查...」逐點反駁 |
| 證據引用 | 引用我方證據支持主張 | 引用對方證據的漏洞 + 我方證據反駁 |
| 法條引用 | 請求權基礎（侵權、契約） | 舉證責任分配 + 抗辯事由 |

**writerStep.ts 的變更：**

1. 接收 `brief_type` 參數
2. 根據 `brief_type` 選擇不同的 writer instruction
3. 答辯狀 instruction 強調：
   - 「針對原告主張，逐一回應」
   - 「每段開頭明確標示在回應什麼」
   - 「用否認/不知/爭執的分類框架」
   - 「引用被告方證據反駁原告主張」

---

## 準備書狀（共用 flow）

準備書狀跟答辯狀共用同一個模式 B flow，差異只在：

| 面向 | 答辯狀 | 準備書狀 |
|------|--------|---------|
| 時機 | 被告第一次回應 | 雙方後續交換 |
| 範圍 | 回應全部主張 | 只回應特定爭點 |
| 語氣 | 全面防禦 | 更聚焦、更具體 |
| 原告也可用 | ❌ | ✅（原告也會提準備書狀） |

**實作差異：**
- `brief_type: 'preparation'` 時，Step 2 prompt 提示「聚焦特定爭點，不需要全面回應」
- 可能需要讓用戶選擇「這份準備書狀要回應哪些爭點」（前端 UI）
- 其他邏輯與答辯狀相同

---

## 前端變更

### 書狀建立時選擇類型

目前用戶說「幫我寫書狀」→ 直接跑 pipeline。需要改為：

1. AgentDO 判斷用戶意圖（寫書狀）
2. 如果案件已有書狀，提問：「要寫什麼類型的書狀？」
3. 或在 UI 上提供書狀類型選擇：
   - 起訴狀（民事）
   - 答辯狀（民事）
   - 準備書狀（民事）

### 書狀列表顯示

`useBriefStore` 需要顯示 `brief_type` 標籤，讓用戶區分同一案件的不同書狀。

---

## 資料流圖

```
案件建立 → 上傳檔案 → AI 分析（disputes/damages/timeline）
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
               起訴狀 flow     答辯狀 flow     準備書狀 flow
                    │               │               │
              Step 0: 完整分析  Step 0: 複用      Step 0: 複用
              Step 1: 法條查詢  Step 1: 法條查詢  Step 1: 法條查詢
              Step 2: 攻擊策略  Step 2: 防禦策略  Step 2: 聚焦策略
              Step 3: 寫攻擊文  Step 3: 寫防禦文  Step 3: 寫聚焦文
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                              共用 ContextStore
                              共用 disputes 表
                              共用 claims 表
                              共用 法條庫
```

---

## 實作順序建議

### Phase 1：最小可行（先讓答辯狀能跑）

1. DB migration：briefs 表加 `brief_type`
2. `writeFullBrief.ts`：加 `brief_type` 參數
3. `caseAnalysisStep.ts`：答辯狀走 `existingDisputes` 路徑
4. `reasoningStrategyPrompt.ts`：新增答辯狀 system prompt
5. `strategyConstants.ts`：新增 `DEFENSE_SECTION_RULES` + `DEFENSE_CLAIMS_RULES`
6. `writerStep.ts`：根據 `brief_type` 切換 writer instruction
7. `schemas/tools.ts`：`writeFullBriefArgsSchema` 加 `brief_type`

### Phase 2：體驗優化

8. 前端：書狀建立時選擇類型
9. 前端：書狀列表顯示類型標籤
10. AgentDO system prompt：引導用戶選擇書狀類型

### Phase 3：準備書狀

11. Step 2 prompt：準備書狀版本（聚焦特定爭點）
12. 前端：選擇要回應的爭點
13. 測試不同案型的準備書狀品質

---

## 不需要改的檔案

| 檔案 | 為什麼不用改 |
|------|-------------|
| `orchestratorAgent.ts` / `orchestratorPrompt.ts` | 案件層級分析，不受書狀類型影響 |
| `templateRenderer.ts` | 已經是通用的模板渲染器 |
| `defaultTemplates.ts` | 答辯狀模板已存在 (`default-civil-defense`) |
| `fileProcessor.ts` | 檔案分類是案件層級，不受書狀類型影響 |
| `lawFetchStep.ts` | 純函式，不受書狀類型影響 |
| `claudeClient.ts` | Citations API 通用 |
| `contextStore.ts` | 資料結構通用（可能需要加 `briefType` 欄位但邏輯不變） |

---

## 風險與注意事項

1. **前提條件**：答辯狀必須在案件已有爭點分析後才能建立。如果用戶直接說「幫我寫答辯狀」但案件沒有做過分析，需要先跑分析或提示用戶
2. **爭點視角翻轉**：disputes 表的 `our_position` / `their_position` 是根據 `client_role` 設定的。如果 `client_role = 'defendant'`，`our_position` 已經是被告立場，不需要翻轉
3. **同案多份書狀**：目前系統假設一個案件一份書狀。支援答辯狀後，同一案件可能有 2-3 份書狀，前端和 API 需要能處理
4. **Claims 累積**：答辯狀會產生新的 claims（rebuttals），這些 claims 應該存在同一個 `claims` 表但關聯到不同的 `brief_id`。目前 claims 表的外鍵是 `case_id`（不是 `brief_id`），需要考慮是否加 `brief_id` 欄位
