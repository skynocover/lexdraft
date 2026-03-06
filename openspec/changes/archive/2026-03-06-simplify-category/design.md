## Context

現有分類系統用 5 個語義 key（ours/theirs/court/evidence/other）描述文件性質，再透過 `getExhibitPrefix(clientRole, category)` 映射到證物 prefix。這層間接映射造成：

1. 律師看到「我方」不知道對應甲證還是乙證
2. 「我方」和「證據」映射到同一 prefix，語義重疊
3. 書狀被錯誤歸入證物

新系統直接用 category key 表達證物歸屬，消除 client_role 轉換層。

## Goals / Non-Goals

**Goals:**
- Category key 直接對應 exhibit prefix，無需 client_role 轉換
- AI 分類時傳入 client_role 一次性判斷甲/乙
- 書狀（brief）不建立證物
- 舊資料（ours/theirs/evidence）在前端可正常顯示

**Non-Goals:**
- 不遷移已有資料的 category 值
- 不改動 exhibit reorder / drag 邏輯
- 不改動 exhibit 手動建立流程

## Decisions

### D1: Category Key 設計

| Key | Label | Badge | Exhibit Prefix |
|-----|-------|-------|---------------|
| `brief` | 書狀 | 狀 | null（不建立） |
| `exhibit_a` | 甲方證物 | 甲 | 甲證 |
| `exhibit_b` | 乙方證物 | 乙 | 乙證 |
| `court` | 法院 | 法 | null |
| `other` | 其他 | 他 | null |

**Rationale**: key 用 `exhibit_a`/`exhibit_b` 而非 `plaintiff`/`defendant`，因為甲/乙是固定的法律慣例（甲=原告），不隨 client_role 變動。

### D2: AI 分類 prompt 改寫

`fileProcessor.ts` 的 `CLASSIFY_PROMPT` 需要知道 client_role 才能判斷甲/乙：
- 從 files 表 join cases 表取得 `client_role`
- Prompt 中明確說明：「本案當事人為{原告/被告}」
- AI 直接輸出 `exhibit_a` 或 `exhibit_b`

### D3: `getExhibitPrefix` 簡化

```
exhibit_a → '甲證'
exhibit_b → '乙證'
其他     → null
```

不再需要 `clientRole` 參數。

### D4: 舊資料 fallback

`categoryConfig.ts` 保留舊 key 的 badge 定義：
- `ours` → 顯示「我」badge（灰色，表示舊分類）
- `theirs` → 顯示「對」
- `evidence` → 顯示「證」

這些只用於顯示，新上傳的檔案不會再產生這些 key。

### D5: Category 變更時的 exhibit 連動

`files.ts` PUT handler 已有 category→exhibit 連動邏輯。簡化為：
- 新 category 是 `exhibit_a` → prefix = 甲證
- 新 category 是 `exhibit_b` → prefix = 乙證
- 其他 → 刪除 exhibit（如果有的話）

不再需要查 `client_role`。

## Risks / Trade-offs

- **舊資料顯示不一致**：舊的 ours/theirs/evidence 會顯示不同的 badge，但不影響功能 → 接受，律師可手動改分類
- **AI 分類需要 client_role**：fileProcessor 要額外查 cases 表 → 一次 DB query，成本低
- **fallbackClassify 也要更新**：無 API key 時的檔名分類邏輯要同步改為新 key
