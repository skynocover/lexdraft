## Context

分析功能已有 ReanalyzeButton（`reanalyze-buttons` change），但缺乏 staleness detection。律師上傳新檔案後，沒有任何視覺提示告知分析已過時。RightSidebar 有 4 個 tab（爭點、卷宗、時間軸、案件），檔案上傳在卷宗 tab，分析在爭點/時間軸 tab，跨 tab 無法看到提示。

核心判斷邏輯：`newCount = readyFiles.filter(f => f.created_at > last_analyzed_at).length`

## Goals / Non-Goals

**Goals:**
- 在 tab 標籤上顯示 badge 數字，不管使用者在哪個 tab 都能看到
- 進入爭點/時間軸 tab 後顯示 inline banner 列出新檔案名稱
- Badge 跨 session 持久化（基於 DB timestamp）
- 分析完成後 badge 自動消失

**Non-Goals:**
- 不做自動重新分析
- 不做 dismiss/已讀功能（v1 先不做）
- 刪除檔案不觸發 stale 提示
- 不改變分析邏輯本身

## Decisions

### D1: 用 timestamp 而非 file IDs 追蹤 staleness

**選擇**：`cases` 表新增 `disputes_analyzed_at` 和 `timeline_analyzed_at` 欄位

**理由**：一個 timestamp 就能判斷哪些檔案是分析後才新增的（`file.created_at > analyzed_at`），不需要存 file IDs 陣列。邏輯簡單、儲存成本低、跨 session 自然持久化。

**替代方案**：
- 存 `analyzedFileIds` JSON 陣列 → 更精準但更複雜、需要解析 JSON
- 前端 Zustand snapshot → 不跨 session、頁面重載就遺失

### D2: per-type 分開追蹤

**選擇**：爭點和時間軸各自一個 timestamp

**理由**：使用者可能只重新分析爭點但不重新分析時間軸，badge 應該獨立顯示。

### D3: Badge 位置 — tab 標籤 + inline banner

**選擇**：兩層提示

| 層級 | 位置 | 內容 | 可見條件 |
|------|------|------|----------|
| Tab badge | RightSidebar tab 標籤旁 | 數字（如 `3`） | 不管在哪個 tab 都可見 |
| Inline banner | 爭點/時間軸 tab 頂部 | 「N 個新檔案尚未納入分析」 | 進入該 tab 時 |

**理由**：Tab badge 解決跨 tab 可見性；inline banner 提供詳細資訊和一鍵重新分析的 CTA。

### D4: 計算邏輯在前端

**選擇**：前端根據 `files` 和 `analyzed_at` 自行計算 newCount

**理由**：前端已有完整的 files list（`useCaseStore.files`）和 case 資料（含 `analyzed_at`），不需要後端額外計算。減少 API 複雜度。

### D5: 第一次分析前不顯示 badge

**選擇**：`analyzed_at` 為 null（從未分析過）時不顯示 badge

**理由**：此時 empty state 的「AI 自動分析」按鈕已經足夠引導使用者。Badge 是給「已分析過但有新檔案」的情境。

## Data Flow

```
分析完成
  → analysisService 寫入 cases.disputes_analyzed_at = new Date().toISOString()
  → API response 回傳 analyzed_at
  → useCaseStore 更新 currentCase.disputes_analyzed_at

檔案上傳完成（status → ready）
  → useCaseStore.files 更新
  → 前端 derived state 重新計算 newFileCount

RightSidebar render
  → disputesNewCount = files.filter(f =>
      f.status === 'ready' &&
      currentCase.disputes_analyzed_at &&
      f.created_at > currentCase.disputes_analyzed_at
    ).length
  → timelineNewCount = 同上用 timeline_analyzed_at
  → tab badge 顯示數字
```

## Risks / Trade-offs

- **[時區問題]** → `created_at` 和 `analyzed_at` 都是 ISO string，比較時以 UTC 為準，D1 SQLite 的 text 欄位直接字串比對即可（ISO 8601 字典序 = 時間序）
- **[polling 延遲]** → 檔案 ready 後靠 3 秒 polling 更新 files，badge 可能延遲幾秒出現 → 可接受
- **[migration]** → 新增欄位為 nullable，不影響既有資料。舊案件的 `analyzed_at` 為 null → 不顯示 badge
