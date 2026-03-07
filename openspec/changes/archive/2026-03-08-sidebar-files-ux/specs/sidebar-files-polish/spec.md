## ADDED Requirements

### Requirement: File dates display in ROC year format
File item 的日期 SHALL 顯示為民國年格式（`YYY-MM-DD`，如 `113-10-12`）。若原始日期已為民國年格式（年份 < 200），SHALL 原樣顯示。

#### Scenario: Western date converted to ROC
- **WHEN** file 的 doc_date 為 `2024-10-12`
- **THEN** 顯示為 `113-10-12`

#### Scenario: Already ROC date
- **WHEN** file 的 doc_date 為 `114-02-18`
- **THEN** 顯示為 `114-02-18`（不做二次轉換）

#### Scenario: No date
- **WHEN** file 沒有 doc_date
- **THEN** 不顯示日期區域

### Requirement: No drag handle spacer for non-exhibit items
沒有 exhibit 的 file item SHALL NOT 渲染 drag handle 或其佔位空白。Badge SHALL 靠左對齊。

#### Scenario: Exhibit item
- **WHEN** file 有 exhibit（甲證/乙證）
- **THEN** 顯示 GripVertical drag handle

#### Scenario: Non-exhibit item
- **WHEN** file 沒有 exhibit（其他文件）
- **THEN** 不顯示 drag handle，badge 直接靠左

### Requirement: Unassigned group label is "其他文件"
未分配 exhibit 的檔案群組 SHALL 使用「其他文件」作為標題，取代「未編號」。

#### Scenario: Group label display
- **WHEN** 有未分配 exhibit 的檔案存在，且同時有已分配 exhibit 的檔案
- **THEN** 群組標題顯示「其他文件」

### Requirement: Doc type selector uses Shadcn Popover
證物的正本/影本/繕本切換 SHALL 使用 Shadcn Popover 元件，取代原生 HTML select。

#### Scenario: Click to change doc type
- **WHEN** 使用者點擊目前的 doc_type 文字（如「影本」）
- **THEN** 彈出 Popover 顯示三個選項（影本、正本、繕本）

#### Scenario: Select doc type
- **WHEN** 使用者在 Popover 中點擊選項
- **THEN** doc_type 更新，Popover 關閉

### Requirement: Category badge shows hover affordance
Category badge SHALL 在 hover 時顯示明確的視覺回饋，暗示可點擊。

#### Scenario: Hover on badge
- **WHEN** 使用者 hover 在 category badge 上
- **THEN** badge 顯示加強的 ring 或亮度變化，cursor 為 pointer

### Requirement: Empty files state shows upload CTA
當案件卷宗區域無檔案時，SHALL 顯示引導性的空狀態畫面，包含上傳按鈕。

#### Scenario: No files in case
- **WHEN** 案件卷宗為空（`files.length === 0`）
- **THEN** 顯示 icon、引導文字、及上傳按鈕

### Requirement: File name tooltip on truncated names
Truncated 的檔名 SHALL 在 hover 時透過 HTML title attribute 顯示完整檔名。

#### Scenario: Long filename hover
- **WHEN** 使用者 hover 在被截斷的檔名上
- **THEN** 瀏覽器原生 tooltip 顯示完整檔名
