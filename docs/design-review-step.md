# 書狀品質審查（Review Step）設計文件

> 目標：Pipeline Step 3 寫完書狀後，自動跑一次品質審查，標記有風險的段落讓律師決定是否修改。

---

## 現狀

- `review_brief` tool 已存在（`src/server/agent/tools/qualityReview.ts`），但只能在 pipeline 結束後由 AgentDO chatbot 手動呼叫
- 內部已有兩層審查：
  - **Layer 1**：`structuralPreCheck.ts` — 純程式碼驗證（claims 覆蓋率、rebuttal 覆蓋率、空段落等）
  - **Layer 2**：呼叫 Claude Sonnet 做 LLM 品質審查
- Zod schema：`reviewBriefArgsSchema = z.object({})`（無參數，審查最新 brief）
- 審查結果以 markdown 格式回傳給 chatbot，前端沒有段落級別的標記

---

## 設計方向

### 核心原則

**Review = Verification（驗證），不是 Critique（批判）。**

| 審查類型 | 用什麼做 | 說明 |
|----------|---------|------|
| 主張 vs 證據有沒有對上 | Gemini Flash | 比對工作，不需要寫作能力 |
| 引用法條跟論證邏輯是否一致 | Gemini Flash | 邏輯判斷 |
| 前後段落事實矛盾 | Gemini Flash | 事實比對 |
| 金額數字前後一致 | 純程式碼 | 規則性檢查 |
| 訴之聲明 vs 事實理由的請求項目一致 | 純程式碼 + Flash | 結構比對 |

**暫不做的**（需要更強模型，成本高）：
- 「這段論證有沒有說服力」— 主觀判斷
- 「對方會怎麼反駁這段」— 深度推理（Critique 層級）

### 模型選擇

用 **Gemini 2.5 Flash**（不是 Claude Sonnet）。理由：

1. Review 是比對和驗證，不是創作，Flash 完全夠用
2. 書狀用 Sonnet 寫 ≠ 需要同等模型審查。審查比寫作簡單——找問題比解決問題容易
3. 成本：Flash 約 Sonnet 的 1/10，可以接受每次 pipeline 都跑
4. 延遲：Flash 回應快，不會讓使用者多等太久

---

## 整合位置

```
目前 Pipeline：
Step 0 → Step 1 → Step 2 → Step 3 → 收尾（清理法條、存版本）→ 結束

加入 Review：
Step 0 → Step 1 → Step 2 → Step 3 → Step 4 (Review) → 收尾 → 結束
```

### 在 `briefPipeline.ts` 中的位置

Step 3（writerStep）完成所有段落後、收尾工作（`cleanupUncitedLaws`、`saveBriefVersion`）之前，插入 Step 4。

```
// briefPipeline.ts 邏輯順序：
1. Step 3 writer 完成所有段落
2. persistBriefContent() — 段落已存 DB
3. ★ Step 4 Review ← 插入點
4. cleanupUncitedLaws()
5. saveBriefVersion()
6. 回傳結果
```

---

## Step 4 Review 的輸入輸出

### 輸入

從 ContextStore 和 DB 取得：

| 資料 | 來源 | 用途 |
|------|------|------|
| 完整書狀段落 | `ContextStore.draftSections[]` | 審查內容 |
| Claims 清單 | `ContextStore.claims[]` | 檢查覆蓋率 |
| 法條清單 | `ContextStore.foundLaws[]` | 檢查引用正確性 |
| 爭點清單 | `ContextStore.legalIssues[]` | 檢查是否每個爭點都有論述 |
| 證物映射 | exhibits 表 | 檢查證物引用完整性 |
| 損害賠償項目 | damages 表 | 檢查金額一致性 |

### 輸出

```typescript
interface ReviewResult {
  passed: boolean;           // 是否通過（所有 critical = 0）
  issues: ReviewIssue[];     // 問題清單
  summary: string;           // 一句話摘要
}

interface ReviewIssue {
  severity: 'critical' | 'warning';
  type: 'evidence_gap' | 'law_mismatch' | 'fact_contradiction' | 'amount_inconsistency' | 'coverage_gap' | 'format';
  paragraph_id: string | null;  // 對應段落 ID（null = 全篇性問題）
  description: string;          // 問題描述（中文）
  suggestion: string;           // 修正建議（中文）
}
```

### 前端顯示

透過 SSE `brief_update` 事件傳送審查結果：

```typescript
// 新 SSE action
{ type: 'brief_update', action: 'set_review_issues', data: ReviewIssue[] }
```

前端在編輯器中：
- `critical` → 段落左邊紅色標記
- `warning` → 段落左邊黃色標記
- 點擊標記 → 展開問題描述和修正建議
- 律師修改段落後標記自動消失（或手動消除）

---

## 審查邏輯分兩層

### Layer 1：純程式碼驗證（擴充現有 `structuralPreCheck.ts`）

現有檢查（保留）：
- Claims 覆蓋率：每個 `ours` claim 是否都有 `assigned_section`
- Rebuttal 覆蓋率：每個 `theirs` claim 是否都有對應 rebuttal
- 空段落檢查

新增檢查：
- **金額一致性**：訴之聲明的總金額 = 各損害項目加總
- **證物引用完整性**：正文提到的「甲證X」是否都存在於 exhibits 表
- **法條引用格式**：引用的法條格式是否正規（「民法第184條」而非「民法184」）
- **段落長度異常**：過短（< 50 字）或過長（> 2000 字）的段落標記

### Layer 2：Gemini Flash LLM 驗證

用 `callGeminiNative()` 做單次呼叫（不需要 tool-loop），prompt 結構：

```
[系統提示]
你是台灣法律書狀的品質審查員。你的任務是找出書狀中的事實性和邏輯性問題。
不要評論文筆或風格，只關注：
1. 主張與證據是否對應
2. 引用法條與論證邏輯是否一致
3. 前後段落的事實陳述是否矛盾
4. 爭點是否都有被論述到

[書狀全文]
（所有段落，含 section/subsection/dispute_id 標記）

[案件資料]
- Claims 清單（含 ours/theirs 分類）
- 法條清單（含條文內容）
- 爭點清單（含雙方立場）
- 損害賠償項目

[輸出格式]
JSON: { issues: [{ severity, type, paragraph_id, description, suggestion }] }
```

用 `responseSchema` constrained decoding 確保輸出格式。

---

## 不做自動重寫

Review 的結果**只標記問題，不自動修正**。理由：

1. 律師需要自己判斷是否接受建議
2. 自動重寫會增加一輪 Sonnet call（成本高、延遲長）
3. 有些「問題」可能是律師故意的策略選擇
4. Human-in-the-loop 的信任建立比自動化更重要

未來如果要加「一鍵修正」，可以對單一段落呼叫 `write_brief_section` tool 重寫。

---

## 相關檔案

| 檔案 | 說明 |
|------|------|
| `src/server/agent/briefPipeline.ts` | Pipeline 主流程，插入 Step 4 的位置 |
| `src/server/agent/tools/qualityReview.ts` | 現有 review_brief tool（可重用部分邏輯） |
| `src/server/agent/tools/structuralPreCheck.ts` | 現有結構檢查（Layer 1 基礎） |
| `src/server/agent/prompts/qualityReviewerPrompt.ts` | 現有審查 prompt（需改為 Flash 版本） |
| `src/server/agent/contextStore.ts` | 取得審查所需資料 |
| `src/server/agent/aiClient.ts` | `callGeminiNative()` 用於 Layer 2 |
| `src/shared/types.ts` | SSE event 型別定義 |
| `src/client/stores/useBriefStore.ts` | 前端接收 review issues |
| `src/client/components/editor/` | 編輯器顯示標記 |

---

## Pipeline Progress 更新

現有 `pipeline_progress` SSE 事件需要加入 Step 4：

```typescript
// 目前 4 步
steps: [
  { name: 'analysis', status: 'completed' },
  { name: 'research', status: 'completed' },
  { name: 'strategy', status: 'completed' },
  { name: 'writing', status: 'completed' },
]

// 變成 5 步
steps: [
  { name: 'analysis', status: 'completed' },
  { name: 'research', status: 'completed' },
  { name: 'strategy', status: 'completed' },
  { name: 'writing', status: 'completed' },
  { name: 'review', status: 'in_progress' },  // 新增
]
```

---

## 預期效果

- 延遲增加：約 3-5 秒（Flash 單次呼叫）
- 成本增加：約 $0.001-0.003 per brief（Flash 極便宜）
- 使用者感知：書狀完成後看到黃/紅標記，知道哪裡要注意
- 律師信任：「AI 自己檢查過了」比「AI 直接丟給你」安心
