# Proposal: 證物編號系統 (Exhibit Numbering System)

## Summary

為案件新增證物編號功能，讓 AI 在書狀生成後自動分配甲證/乙證編號，律師可手動調整，最終自動產出證物清單。全流程零額外 AI token（純資料驅動）。

## Motivation

目前書狀內引用檔案時使用原始檔名（如「起訴書.pdf」），不符合台灣法院書狀慣例。律師提交書狀前必須手動：
1. 為每個引用的檔案分配證物編號（甲證1、甲證2...）
2. 將書狀內所有引用從檔名改為證物編號
3. 製作證物清單（附於書狀末尾）

這些都是機械性工作，可以完全自動化。

## Design

### 核心概念

- **Case-level exhibits**：證物編號綁定在案件（case）層級，全案一致，跨書狀延續（符合台灣法院實務）
- **AI 先給，律師再改**：書狀 pipeline 完成後自動分配編號，律師可排序、手動修改
- **零 token 成本**：自動分配和證物清單生成都是純 JS/SQL 邏輯，不需 AI 呼叫
- **Render-time mapping**：不修改 content_structured 中的 citation.label（保持原始檔名），前端渲染時透過 exhibit mapping 顯示證物編號

### 編號規則

| client_role | file.category | prefix |
|-------------|---------------|--------|
| plaintiff   | ours          | 甲證   |
| plaintiff   | theirs        | 乙證   |
| plaintiff   | evidence      | 甲證   |
| defendant   | ours          | 乙證   |
| defendant   | theirs        | 甲證   |
| defendant   | evidence      | 乙證   |
| *           | court         | null（預設不編，可手動加入） |
| *           | other         | null（預設不編，可手動加入） |

- 甲證、乙證各自獨立遞增：甲證1, 甲證2... / 乙證1, 乙證2...
- 編號格式：阿拉伯數字（甲證1，非甲證一）

### 自動分配策略

書狀生成後，掃描 paragraphs 中所有 `type='file'` 的 citations，按首次出現順序（paragraph order x citation order）分配編號。已有編號的 file 不重複分配，新 file 接續編號。

### 資料模型

新增 `exhibits` 表（case-level）：

```sql
CREATE TABLE exhibits (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  file_id TEXT NOT NULL REFERENCES files(id),
  prefix TEXT,           -- '甲證' | '乙證' | null
  number INTEGER,        -- 1, 2, 3...
  doc_type TEXT DEFAULT '影本',  -- '影本' | '正本' | '繕本'
  description TEXT,      -- 備註/簡短說明
  created_at TEXT,
  UNIQUE(case_id, file_id)
);
```

### Citation 顯示策略（Render-time mapping）

content_structured 中的 `citation.label` 保持原始檔名不動。前端渲染時：
- 建立 `file_id → exhibit label` mapping（從 exhibits 表查詢）
- `CitationNodeView`、`exportDocx`、`CitationReviewModal` 透過 mapping 顯示證物編號
- 無 exhibit 時 fallback 顯示原始檔名
- Exhibit 操作只改 exhibits 表，不碰 content_structured，零 sync 風險

### 證物清單生成

純查詢渲染，零 AI token：
- 查 `exhibits` 表 JOIN `files` → 按 prefix + number 排序
- 自動填入：編號、名稱（filename）、類型（doc_type）、日期（files.doc_date）、備註（description / files.summary 第一句）

## Scope

### In Scope

- `exhibits` 表 schema + migration
- 後端 CRUD API（`/api/cases/:caseId/exhibits`）
- Pipeline 完成後自動分配邏輯（`assignExhibits()`，純 JS）
- 前端 render-time mapping（CitationNodeView、exportDocx、CitationReviewModal）
- 前端證物清單 Tab（顯示、排序、編輯、新增、刪除）
- 證物清單匯出（表格格式）

### Out of Scope

- 證物清單 PDF/Word 排版匯出（可後續迭代）
- 證物子編號（如甲證1-1、甲證1-2；一檔案一證物）
- 法條的編號系統（法條引用不需要證物編號）
- 待證事項自動推導（v1 律師手填 description，未來可從 citations → disputes 反推）

## Non-goals

- 不改變現有 Citation 資料結構（`id`, `label`, `type`, `file_id` 等欄位不動）
- 不修改 content_structured JSON（citation labels 保持原始檔名）
- 不影響 Claude Citations API 的運作方式
- 不在 pipeline AI 呼叫中加入證物編號邏輯（保持零 token 成本）

## Risks

| Risk | Mitigation |
|------|-----------|
| Citation label 更新不完整 | 不改 label，用 render-time mapping 徹底迴避此問題 |
| 拖放排序後忘記存 | auto-save，排序變更即時寫入 DB |
| 新書狀引用了尚未編號的 file | assignExhibits 只補新的，已有編號不動 |
