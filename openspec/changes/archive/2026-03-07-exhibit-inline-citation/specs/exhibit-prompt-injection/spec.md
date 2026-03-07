## ADDED Requirements

### Requirement: Writer prompt includes exhibit mapping
Pipeline Step 3 Writer MUST 在 prompt 中注入每個案件文件的證物編號（中文數字格式），讓 AI 在行文中自然使用。

#### Scenario: Content section prompt includes exhibit labels
- **WHEN** writerStep 為有 dispute_id 的段落建構 prompt
- **THEN** 文件列表中每個有 exhibit 的文件 SHALL 附加「（甲證X）」格式，如：`案件文件：「01_交通事故初步分析研判表.pdf」（甲證一）`

#### Scenario: Intro/conclusion prompt does not include exhibit labels
- **WHEN** writerStep 為前言或結論段落（dispute_id 為 null）建構 prompt
- **THEN** SHALL 不注入 exhibitMap，維持現有 prompt 格式

### Requirement: Writer prompt instructs exhibit citation format
Writer prompt 的撰寫規則 MUST 包含證物引用格式指引。

#### Scenario: Writing rules include exhibit reference instructions
- **WHEN** writerStep 建構 prompt 且有 exhibitMap 資料
- **THEN** 撰寫規則 SHALL 包含：
  - 引用案件文件時必須附加證物編號，格式為「有○○可稽（甲證X）」或類似法律用語
  - 同一段落再次引用同一文件時可直接使用證物編號

### Requirement: Pipeline loads exhibit mapping before writer step
briefPipeline MUST 在 Step 3 Writer 開始前，從 exhibits 表載入 file_id → 中文證物編號的 mapping，並傳入每個 writeSection 呼叫。

#### Scenario: ExhibitMap available to writer
- **WHEN** pipeline 進入 Step 3 Writer
- **THEN** SHALL 從 DB 查詢 exhibits 表，建構 `Map<fileId, chineseLabel>` 並傳入 writeSection

### Requirement: Pipeline records exhibit label on file citations
Pipeline 完成書狀後，每個 file citation 物件 MUST 包含 `exhibit_label` 欄位，記錄 pipeline 時分配的中文證物編號。

#### Scenario: Citation includes exhibit_label after pipeline
- **WHEN** pipeline Step 3 完成段落寫作
- **THEN** 每個 type=file 的 citation SHALL 包含 `exhibit_label` 欄位（如「甲證一」），供後續重排同步使用
