## ADDED Requirements

### Requirement: 卷宗分類擴充為 6 類

系統 SHALL 支援以下 6 種檔案分類，取代現有的 5 種：

| key | badge | label | 用途 |
|-----|-------|-------|------|
| `brief_theirs` | 對 | 對方書狀 | 對造提出的書狀（起訴狀、答辯狀、準備書狀等） |
| `exhibit_a` | 甲 | 甲方證物 | 原告方證物（不變） |
| `exhibit_b` | 乙 | 乙方證物 | 被告方證物（不變） |
| `judgment` | 判 | 判決 | 法院判決書 |
| `court` | 法 | 法院文件 | 裁定、筆錄、通知等非判決的法院文件 |
| `other` | 他 | 其他 | 無法分類的文件 |

移除原有的 `brief` 分類（我方書狀在 briefs 表中編輯，不在卷宗檔案中）。

#### Scenario: 前端 sidebar 顯示 6 類 badge
- **WHEN** 檔案有 category 值
- **THEN** sidebar 顯示對應的 badge 字元和顏色

#### Scenario: 律師手動修改分類
- **WHEN** 律師點擊 sidebar 檔案的 badge
- **THEN** 出現 6 個分類選項的 picker，律師可選擇新分類

### Requirement: AI 自動分類支援 6 類

fileProcessor 的 AI 分類 SHALL 輸出 6 類 enum 值之一。分類依據：

- `brief_theirs`：對方（非我方）提出的書狀（起訴狀、答辯狀、準備書狀、爭點整理狀等）
- `judgment`：法院判決書
- `court`：裁定、筆錄、通知書、調解紀錄等法院文件（非判決）
- `exhibit_a` / `exhibit_b`：依 clientRole 判斷甲乙方證物
- `other`：無法歸類

#### Scenario: AI 正確分類對方書狀
- **WHEN** 上傳一份「被告民事答辯狀」PDF，案件 clientRole 為 plaintiff
- **THEN** AI 分類為 `brief_theirs`

#### Scenario: AI 正確分類判決
- **WHEN** 上傳一份含有「主文」「事實及理由」段落的法院判決書 PDF
- **THEN** AI 分類為 `judgment`

#### Scenario: AI 區分判決與裁定
- **WHEN** 上傳一份法院裁定書 PDF
- **THEN** AI 分類為 `court`（非 `judgment`）

#### Scenario: 無 AI 時的 fallback 分類
- **WHEN** 無 AI Gateway 設定（CF_AIG_TOKEN 為空）
- **THEN** 使用檔名關鍵字 fallback：含「答辯」「起訴」「準備」→ `brief_theirs`；含「判決」→ `judgment`；含「裁定」「筆錄」「通知」「調解」→ `court`

### Requirement: 向後相容舊分類值

系統 SHALL 正常處理舊檔案中的 `brief` 和 `court` category 值。

#### Scenario: 舊 brief 值顯示
- **WHEN** 檔案 category 為 `brief`（舊值）
- **THEN** 前端顯示為 `brief_theirs` 的 badge 和 label（fallback）

#### Scenario: 舊 court 值顯示
- **WHEN** 檔案 category 為 `court`（舊值）
- **THEN** 前端顯示為 `court` 的 badge 和 label（行為不變）

#### Scenario: Pipeline 匹配舊 brief 值
- **WHEN** pipeline 在 supplement 模式下過濾對方書狀
- **THEN** SHALL 同時匹配 `brief_theirs` 和 `brief`
