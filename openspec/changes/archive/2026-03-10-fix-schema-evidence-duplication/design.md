## Context

Step 2 pipeline 的 structuring prompt 包含 `STRATEGY_JSON_SCHEMA`（JSON 範例）和 `SECTION_RULES`（段落規則），兩者都寫死損害賠償 template 的 section 命名。當使用其他 template 時，AI 面臨 template 與範例的命名衝突，導致 section 名稱錯誤（Bug 2）。同時 AI 不知道證據方法由程式產出，自行規劃導致重複（Bug 3）。

現有架構：
- Template 透過 `templateToPrompt()` 完整注入 prompt（已存在）
- Gemini constrained decoding 透過 `STRATEGY_RESPONSE_SCHEMA` 強制 JSON 結構（已存在）
- `STRATEGY_JSON_SCHEMA` 的 JSON 範例同時負責「教 JSON 格式」和「示範 section 命名」兩個職責

## Goals / Non-Goals

**Goals:**
- 讓 Step 2 AI 輸出的 section 名稱正確匹配任何 template
- 讓 Step 2 AI 知道哪些段落該規劃、哪些不該碰
- 方案對未來新增 template 或律師自定義 template 免維護

**Non-Goals:**
- 不改 Gemini constrained decoding schema（`STRATEGY_RESPONSE_SCHEMA`）
- 不改 Step 3 writer 的邏輯
- 不處理律師自定義 template 的 UI/儲存機制（未來功能）

## Decisions

### 1. 用中文編號（壹、貳、參…）解析 template 段落，而非 `##` markdown header

**理由**：中文編號是法律文書的本質結構，`##` 是 markdown 實作細節。律師自定義 template 時可能不寫 `##`，但幾乎一定會用中文編號。Template 是結構骨架，`壹、` 出現在行首 100% 是段落標題，不會有誤判。

**替代方案**：用 `##` 解析 — 更精確但依賴 markdown 格式，對自定義 template 不夠健壯。

### 2. 段落分類為三種類型：`fixed` / `ai_planned` / `system_generated`

- **fixed**：已有完整法律文字的段落（訴之聲明、答辯聲明、上訴聲明、執行名義、請求金額、聲請執行標的），AI 不規劃
- **system_generated**：由程式自動產出的段落（證據方法、證據），AI 不規劃
- **ai_planned**：需要 AI 規劃的段落（前言、事實及理由、結論等）

分類用關鍵字匹配，規則硬編碼在 `extractSections()` 中。

### 3. JSON 範例改為通用佔位符，不綁定特定 template

`STRATEGY_JSON_SCHEMA` 中的 section 值改為 `"（依範本段落名稱）"`，只示範 JSON 結構。段落命名由動態注入的段落清單指定。

### 4. 在 `briefPipeline.ts` 加防禦過濾作為兜底

即使 prompt 指示正確，AI 偶爾仍可能違規產出證據方法段落。在組裝 `allParagraphs` 前，從 AI writer 產出的段落中過濾掉 section 包含「證據」的段落。

## Risks / Trade-offs

- **中文編號解析的邊界案例**：如果 template 的段落標題不以壹貳參等開頭（例如用阿拉伯數字），parser 會漏抓 → 但現有 6 個 template 和台灣法律慣例都用中文編號，風險極低
- **分類關鍵字可能不完整**：新的 template 類型可能有未預見的固定段落名稱 → 預設為 `ai_planned`，最壞情況是多寫了一段不需要的內容，不會漏寫
- **泛化 WRITING_CONVENTIONS 後 AI 可能不寫前言/結論**：移除「每份書狀應包含前言段落與結論段落」後，某些 template 可能缺少前言/結論 → 由動態段落清單明確標記哪些段落需要規劃來解決
