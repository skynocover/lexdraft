# LexDraft Pipeline — 影響書狀產出的所有因素

> 每一步的輸入、模型、prompt、參數、產出完整對照

---

## 用戶直接控制的

```
                    ┌─────────────────────┐
                    │   用戶直接控制的      │
                    └──────────┬──────────┘
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
     clientRole          template          caseInstructions
   (plaintiff /        (選哪份範本)         (自由文字指示)
    defendant)              │
                     ┌──────┴──────┐
                     │             │
              結構 (content_md)  briefMode
              header/sections    (5 值)
              footer/fixed         │
                     │             │
                     │    resolvePipelineMode()
                     │             │
                     │       PipelineMode
                     │     (claim / defense)
                     │             │
                     │      4 組 prompt 二選一
                     │             │
                     ▼             ▼
```

**briefMode 5 值** → **PipelineMode 2 值**：

| briefMode | 說明 | → PipelineMode |
|-----------|------|---------------|
| `claim` | 提出請求（起訴等） | **claim** |
| `defense` | 回應對方（答辯等） | **defense** |
| `supplement` | 補充攻防（準備書狀） | defendant → **defense**，否則 **claim** |
| `challenge` | 挑戰裁判（上訴等） | **claim** |
| `petition` | 聲請法院（強制執行等） | **claim** |

**其他用戶輸入**：

```
├─ 上傳的檔案（全文 + AI 摘要）
├─ 填寫的當事人（原告/被告姓名）
├─ 填寫的案號、法院
├─ 手動加入的法條
├─ 手動編輯的爭點、金額、時間軸
└─ 手動編輯的不爭執事項
```

---

## 按 Pipeline 步驟

### Step 0：案件分析

**模型：Gemini 2.5 Flash**

```
輸入因素                          產出（傳給下游）
─────────────                     ────────────────
檔案全文（用戶上傳）          ──→  caseSummary
當事人（用戶填 or AI 偵測）   ──→  parties
clientRole                   ──→  our_position / their_position 方向
caseInstructions             ──→  注入 Case Reader + Issue Analyzer
templateTitle                ──→  注入提示
                                   ├─ disputes（爭點）
                                   ├─ undisputedFacts（不爭執事項）
                                   ├─ damages（金額）
                                   ├─ timeline（時間軸）
                                   └─ informationGaps
```

**涉及的 Prompt**：
- `CASE_READER_SYSTEM_PROMPT` — 讀檔 → FileNote (key_facts, claims, key_amounts, mentioned_laws)
- `ISSUE_ANALYZER_SYSTEM_PROMPT` — 分析 → disputes, undisputed_facts, information_gaps

```
                              ▼
```

---

### Step 1：法條抓取

**純程式，無 AI**

```
輸入因素                          產出
─────────────                     ────────────────
disputes.mentioned_laws      ──→  fetchedLaws（法條全文）
手動加入的法條               ──→  userAddedLaws
```

**影響查詢結果的常數**：
- `PCODE_MAP` — 法條名稱 → DB _id 對照
- `CONCEPT_TO_LAW` — 概念改寫表（如「侵權行為」→ 民法 §184）
- `MAX_LAW_CONTENT_LENGTH = 600` — 給 Step 2 的截斷版（Writer 拿全文）
- `MongoDB Atlas` — 法條資料庫的完整性

```
                              ▼
```

---

### Step 2：法律推理 + 策略

#### Phase 2a：Reasoning

**模型：Claude Haiku 4.5 + tool loop**

```
輸入因素                          產出
─────────────                     ────────────────
★ PipelineMode               ──→  選哪套 workflow / rules
★ caseTypeGuidance           ──→  案型攻防指南（0~2 個案型）
★ templateContentMd          ──→  完整範本 markdown 注入
★ caseInstructions           ──→  律師處理指引注入
  caseSummary                ──→  案件全貌
  clientRole / caseMetadata  ──→  我方立場、案號、法院
  disputes + positions       ──→  爭點 + 雙方立場
  fetchedLaws (截斷版)       ──→  已查法條
  userAddedLaws              ──→  手動法條
  fileSummaries              ──→  檔案摘要
  damages                   ──→  金額項目
  timeline                  ──→  時間軸
  undisputedFacts            ──→  不爭執事項
  search_law 結果            ──→  補充法條（最多 6 次搜尋）
                                   ──→ reasoningSummary
                                   ──→ perIssueAnalysis[]
```

> ★ = 高槓桿因素（改動直接影響推理方向）

**涉及的 Prompt**：
- `buildReasoningSystemPrompt()` — 根據 mode 選擇 workflow
  - claim → `COMPLAINT_REASONING_WORKFLOW`（4 階段：法律基礎 → 要件對應 → 預測防禦 → 補充搜尋）
  - defense → `DEFENSE_REASONING_WORKFLOW`（3 層：解構原告主張 → 防禦策略 → 積極抗辯）
- `COMMON_SEARCH_INSTRUCTIONS`
- `COMMON_TOOLS_AND_RULES`
- `COMMON_CONTEXT_RULES`
- `COMMON_HARD_RULES`

**Pipeline 參數**：

| 常數 | 值 |
|------|-----|
| MAX_ROUNDS | 6 |
| MAX_SEARCHES | 6 |
| SOFT_TIMEOUT_MS | 25000 |
| MAX_TOKENS | 8192 |
| TOOL_RESULT_MAX_CHARS | 200 |
| CLAUDE_MODEL | claude-haiku-4-5-20251001 |

```
                              ▼
```

#### Phase 2b：Structuring

**模型：Gemini 2.5 Flash + constrained decoding**

```
輸入因素                          產出
─────────────                     ────────────────
reasoningSummary             ──→  claims[]（攻防主張）
perIssueAnalysis[]           ──→  sections[]（段落策略）
所有法條 + ID 對照表          ──→  perIssueAnalysis（傳遞）
所有爭點 + ID 對照表          ──→  reasoningSummary（傳遞）
所有檔案 + ID 對照表
所有金額 + dispute 對照
```

**涉及的 Prompt / Schema**：
- `buildJsonOutputSystemPrompt()`
- `buildStrategySchema()` — 動態 enum 約束 dispute_id, file_id, law_id（防幻覺）
  - claim → `CLAIMS_RULES` + `SECTION_RULES` + `STRATEGY_JSON_SCHEMA`
  - defense → `DEFENSE_CLAIMS_RULES` + `DEFENSE_SECTION_RULES` + `DEFENSE_JSON_SCHEMA`
- `WRITING_CONVENTIONS` — 中文編號、template 結構等

**Pipeline 參數**：

| 常數 | 值 |
|------|-----|
| JSON_OUTPUT_MAX_TOKENS | 32768 |
| responseSchema | constrained decoding（防止幻覺 ID） |

```
                              ▼
```

#### 後處理（純程式）

- → `enrichStrategyOutput()` — Levenshtein 模糊修正壞 dispute_id（≤3 edits）（目前已退化為 0 修正）
- → `validateStrategyOutput()` — 11 項結構檢查：
  - section ID 唯一
  - 非前言結論有 claims + subsection
  - 每個 dispute 有對應段落
  - claims 指向有效 section
  - rebuttal 有 responds_to
  - legal_basis ⊆ relevant_law_ids
  - ...等

**最終產出**：
- `claims[]` — side, type, statement, dispute_id, responds_to, assigned_section
- `sections[]` — section, subsection, dispute_id, argumentation, claims, relevant_file_ids, relevant_law_ids, legal_reasoning

```
                              ▼
```

---

### Step 3：撰寫（per section）

根據 section 類型分流三軌：

#### Track A — Content Sections

**模型：Claude Sonnet 4.6 + Citations API**
**條件：subsection ≠ null（有 dispute_id 的段落）**

**Writer Prompt 結構 — `buildWriterInstruction()`**：

```
 1. [書狀全局資訊]        — title, caseMetadata, caseInstructions, fullOutline
 2. [提供的來源文件]      — file list + law references
 3. [本段負責的 Claims]   — 分配到此段的 claims (side/type labels)
 4. [本段論證結構]        — argumentation (legal_basis, fact_application, conclusion)
 5. [本段推理指引]        — legal_reasoning 自由文字（if exists）
 6. [事實運用]           — facts_to_use[] + 使用說明（if exists）
 7. [爭點資訊]           — title, our_position, their_position（if dispute）
 8. [已完成段落]          — 之前寫完的段落全文（保持一致性）
 9. [撰寫規則]           — COMMON_WRITING_RULES（15 條）
10. [答辯狀撰寫規則]      — DEFENSE_WRITING_RULES（7 條，defense only）
11. [證物編號規則]        — EXHIBIT_RULES（if exhibits exist）
```

**Citations API 參數**：
- `MAX_CHUNK_LENGTH = 800` — 文件切 chunk 上限
- 切分策略：先按 `##` header，再按 `。` 句號，最大 800 chars/chunk
- citation mapping：document_index + block_index → 原始文件 + chunk 位置

**3-Tier Law Fallback — `resolveLawsForSection()`**：

```
① relevant_law_ids 有值           → 使用 enrichment 結果
② 空 + 有 dispute_id             → 從 perIssueAnalysis.key_law_ids 推導
③ content section 但 tier 1+2 空  → ALL foundLaws
   intro/conclusion               → 空陣列
```

**產出** → `Paragraph` {id, section, subsection, content_md, segments, citations, dispute_id}

---

#### Track B — Intro / Conclusion

**模型：Gemini 2.5 Flash（text/plain）**
**條件：subsection = null**

**Prompt 結構 — `buildIntroOrConclusionBlock()`**：

```
[案件事實摘要]        — caseSummary
[爭點列表]           — disputes titles
[賠償項目]           — damages list
[本段撰寫範圍]       — section 名稱（前言 or 結論）
[前言/結論特殊規則]   — 字數限制等
```

**產出** → `Paragraph` {content_md, citations: []}（無引用）
- 前言 ~220 字 · 結論 ~280 字

---

#### Track C — Auto-Generated Sections

**純程式，無 AI**

- `formatEvidenceSection()` — 證據方法段落（甲證一、甲證二…排序）

```
                              ▼
```

---

### 最終後處理

**文字清理**：
- → `stripMarkdown()` — 移除 `###`、`>`、`**` 格式標記
- → `stripLeadingHeadings()` — 移除 AI 重複產生的段落標題
- → `rebuildSegmentsAfterStrip()` — 確保 segments 拼接 = content_md
- → `stripFFFD()` — 清除 AI Gateway 的 U+FFFD 亂碼（兩個邊界：Gemini + Claude）

**資料持久化**：
- → `persistClaims()` — 刪舊 + 批次寫入 claims
- → `persistBriefContent()` — UPDATE briefs.content_structured（完整 JSON）
- → `persistExhibits()` — 自動分配證物編號（甲證一、乙證一…）
- → `cleanupUncitedLaws()` — 移除未被引用且非手動的法條
- → `saveBriefVersion()` — 版本快照

---

## Template 的影響路徑

```
template
  │
  ├─ templateContentMd ─────────── 完整 markdown 注入 Step 2 reasoning prompt
  │
  ├─ briefMode (5 值)
  │    │
  │    └─ resolvePipelineMode(briefMode, clientRole)
  │         │
  │         └─ PipelineMode = 'claim' | 'defense'
  │              │
  │              ├─ claim   → CLAIMS_RULES
  │              │            SECTION_RULES
  │              │            STRATEGY_JSON_SCHEMA
  │              │            COMPLAINT_REASONING_WORKFLOW
  │              │
  │              └─ defense → DEFENSE_CLAIMS_RULES
  │                           DEFENSE_SECTION_RULES
  │                           DEFENSE_JSON_SCHEMA
  │                           DEFENSE_REASONING_WORKFLOW
  │                           + DEFENSE_WRITING_RULES (Step 3)
  │
  └─ header / sections / footer ── templateRenderer 解析
       │
       ├─ fixed sections ────────── 保留原文
       ├─ fillable sections ─────── Gemini Flash 填入（○○/【待填】）
       └─ filterWritableSections() ─ 移除已 render 和 auto-generated 段落
```

---

## ContextStore — 步驟間資料中樞

```
      寫入者                          ContextStore                    讀取者
      ──────                          ────────────                    ──────

Step 0 ──→ legalIssues                                    getContextForSection(i) ──→ Writer
           damages                    ┌──────────┐
           timeline               ──→ │          │ ──→    Background:
           parties                    │  Context  │         caseSummary
           caseMetadata               │  Store    │         templateTitle
                                      │          │         fullOutline
Step 1 ──→ setFoundLaws()             │          │
                                      │          │ ──→    Focus:
Step 2a ──→ addSupplementedLaws()     │          │         claims
            setReasoningSummary()      │          │         argumentation
            setPerIssueAnalysis()     │          │         laws (3-tier fallback)
                                      │          │         fileIds
Step 2b ──→ setStrategyOutput()       │          │         factsToUse
            (claims, sections)        │          │         legal_reasoning
                                      │          │
Step 3 ──→ addDraftSection()          │          │ ──→    Review:
            (寫完一段加一段)           └──────────┘         completedSections（之前段落）
```

---

## 模型分佈總覽

| 步驟 | 模型 | 用途 |
|------|------|------|
| Case Reader | Gemini 2.5 Flash | 讀檔 + 摘要 + 結構化 |
| Issue Analyzer | Gemini 2.5 Flash | 爭點分析 + 不爭執事項 |
| Step 1 法條 | 無 AI | MongoDB 查詢 |
| Step 2a 推理 | **Claude Haiku 4.5** | 自由推理 + tool loop |
| Step 2b 結構化 | Gemini 2.5 Flash | constrained decoding → JSON |
| Step 3 內容段落 | **Claude Sonnet 4.6** | 撰寫 + Citations API |
| Step 3 前言/結論 | Gemini 2.5 Flash | text/plain 撰寫 |
| Template 填充 | Gemini 2.5 Flash | placeholder 替換 |

---

## caseTypeGuidance

`getCaseTypeGuidance(caseSummary, clientRole)` 從 caseSummary 關鍵字偵測案型：

| 案型 | 觸發關鍵字 |
|------|-----------|
| trafficAccident | 車禍、肇事、交通事故… |
| loanDispute | 借款、借貸、消費借貸… |
| leaseDispute | 租賃、房東、承租人… |
| laborDismissal | 解僱、資遣、終止勞動契約… |
| laborOvertime | 加班費、延長工時… |
| laborInjury | 職災、職業傷害… |

- 關鍵字命中 ≥ 2 才算匹配，取 top 2 案型
- 根據 clientRole 附加攻/防專屬指南
- 匹配 0 個 → 回傳 null，不注入任何指南

---

## 影響因素統計

| 類別 | 數量 | 範例 |
|------|------|------|
| 用戶輸入 | ~8 | 檔案、原被告、案號、法院、clientRole、instructions、手動法條、template |
| AI Models | 4 | Gemini Flash（分析/結構化/前言結論）、Haiku（推理）、Sonnet（寫作） |
| Prompt / Rules | ~15 | 6 個 system prompt + 各種 rules + writing conventions |
| 外部資料 | ~3 | MongoDB 法條庫、PCODE_MAP、CONCEPT_TO_LAW |
| Pipeline 參數 | ~8 | MAX_ROUNDS、MAX_SEARCHES、TIMEOUT、MAX_TOKENS、截斷長度等 |
| 後處理邏輯 | ~7 | enrichment、validation、markdown strip、law fallback、exhibit 分配 |
| 資料流設計 | ~5 | ContextStore、3-tier fallback、document chunking、constrained decoding |
| **合計** | **~46** | |
