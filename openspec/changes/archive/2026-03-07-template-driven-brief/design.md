## Context

LexDraft 的書狀生成 pipeline 目前由 `briefType`（complaint/defense/preparation/appeal）驅動。briefType 控制：
- `briefAssembler.ts` 的 `BRIEF_CONFIGS`：hardcoded header/declaration/footer 格式
- `strategyConstants.ts` 的 `BRIEF_TYPE_FALLBACK_STRUCTURES`：4 種結構骨架
- `defaultTemplates.ts`：8 個百科全書式範本（每個 ~190 行）
- Agent tools 的 `brief_type` enum 參數
- 前端 `briefTypeConfig.ts` 的 badge/label 對照

App 尚未上線，可以直接重構而不需要向後相容。

ref/templates 中有 8 個參考範本（01-08），每個涵蓋一個訴訟類別下的多種書狀。分析發現不同類別的 header/footer 格式差異顯著（當事人稱謂、法院庭別、欄位數量），無法用一組 config 涵蓋。

## Goals / Non-Goals

**Goals:**

- Template 成為書狀結構的 single source of truth，取代 briefType
- 律師可在 TemplateEditor 中直接編輯完整書狀骨架（含 header/footer 格式 + 段落指引），所見即所得
- 預設範本開箱即用，AI 可自動選擇
- 不使用範本時有通用 fallback 指引
- 新增書狀類型只需新增一個 template markdown，不需改程式碼

**Non-Goals:**

- 不做 template 版本管理
- 不做 template 跨使用者共享
- 不處理 header 中的詳細個人資料填寫（性別、身分證、地址等由律師在 Tiptap 中手動填）
- 不改 templates 表結構（不加 party_labels、court_suffix 等欄位）
- 不改 TemplateEditor UI（維持純 markdown 編輯器）

## Decisions

### D1: Template = 完整書狀骨架，含 header/footer

**選擇**: Template 的 `content_md` 包含完整文件格式（header 區、## 段落、footer 區），不只是 AI 指引。

**替代方案**:
- A) Template 只含 AI 段落指引，header/footer 由 assembler 產生 → 需要 party_labels/court_suffix 額外欄位或 metadata，且 assembler 需為每種類型寫 config
- B) Template 含完整格式 + YAML frontmatter metadata → 律師需學習 YAML 語法
- C) Template 含完整格式 + `{{placeholder}}` → 律師看到 `{{plaintiff}}` 會困惑，且案件資料不該在 template 裡重複

**理由**: 不同案件類型的 header 差異大（欄位數量、稱謂、庭別），放在 template 裡是最自然的表達。律師在 TemplateEditor 看到完整文件格式，所見即所得。不需要任何特殊語法或額外 DB 欄位。

### D2: Header/靜態段落/Footer 由 Gemini Flash Lite 渲染

**選擇**: 用一次 Flash Lite call 將 template 的 header + 靜態段落（如訴之聲明）+ footer 與案件資料合併。

**替代方案**:
- A) 寫 code parser 解析 template markdown → 需處理多行結構、不同格式，每換 template 格式可能壞掉
- B) 保留 assembler，從 template 解析 metadata → 回到 briefType 問題

**理由**: Template header 格式多樣（有的有送達代收人、有的有未成年子女）。Flash Lite 天然能「看模板、填資料」，不需 parser。成本 < $0.001/次，延遲 < 1 秒。

### D3: Strategy agent 自行判斷靜態 vs AI 段落

**選擇**: 把 template 全文（placeholder 未填）傳給 strategy agent，由 agent 判斷哪些 `##` 段落需要 AI 寫、哪些已有內容。

**替代方案**:
- A) 用 `<!-- -->` HTML comment 標記 AI 段落 → 律師看不到 comment，無法編輯指引
- B) Renderer code 判斷 → 需要啟發式規則，容易誤判

**理由**: Strategy agent 已經在讀 template 決定段落計畫。「說明案件背景...」是指引、「一、被告應給付原告＿＿元...」是成品——LLM 分辨這兩者毫無困難。零額外標記、零額外程式碼。

### D4: briefs.brief_type → briefs.template_id

**選擇**: 移除 `brief_type` 欄位，新增 `template_id` nullable 欄位。

**理由**: 記錄這份書狀是用哪個範本生成的，方便追溯和重新生成。App 未上線，不需向後相容。

### D5: 證據方法由 code 格式化

**選擇**: 從 `exhibits` 表查詢，程式化產出「甲證一　xxx」列表。

**替代方案**: 用 Flash Lite 生成 → 多一次 AI call，但內容完全確定性

**理由**: exhibits 表已有完整資料（prefix、number、description、doc_type），格式固定，~15 行程式碼即可。比 AI 更快、更準、零成本。

### D6: 預設範本從 ref/templates 濃縮

**選擇**: 從 8 個類別參考範本中拆出 4-8 個具體書狀範本，每個 30-50 行。

**理由**: 一個 template 對應一種書狀，AI 才能聚焦。190 行的類別範本太廣、太多選項，是目前「AI 沒按 template 寫」的根本原因。

## Risks / Trade-offs

**[Flash Lite 填錯資料]** → 驗證 output 是否包含 input 的 plaintiff/defendant 名字。Header/footer 內容極簡單，出錯機率低。

**[Strategy agent 誤判靜態/AI 段落]** → 在 prompt 中加一句「已有完整法律文字的段落不要規劃」。測試時用現有的車禍案 benchmark 驗證。

**[預設範本數量不足]** → 初期只做最常用的 4-8 種。律師可自行建立自訂範本。新增範本不需改程式碼。

**[不使用範本的 fallback 品質]** → prompt 內建一段通用指引（前言 → 事實及理由 → 結論），確保無 template 時仍可生成基本結構的書狀。

**[Migration 風險]** → App 未上線，只有開發環境資料。直接改 schema，不需 rollback 策略。
