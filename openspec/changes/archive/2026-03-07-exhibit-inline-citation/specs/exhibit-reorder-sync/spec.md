## ADDED Requirements

### Requirement: Exhibit reorder updates brief text
律師在 ExhibitsTab 重排證物編號後，書狀正文中的舊證物編號文字 MUST 自動更新為新編號。

#### Scenario: Reorder updates content_md and segments
- **WHEN** 律師在 ExhibitsTab 將甲證一和甲證二對調（甲證一 → 甲證二，甲證二 → 甲證一）
- **THEN** 所有段落的 content_md 和 segments 中，原本的「甲證一」SHALL 更新為「甲證二」，「甲證二」SHALL 更新為「甲證一」

#### Scenario: Reorder updates citation exhibit_label
- **WHEN** exhibit 重排完成
- **THEN** 每個受影響 citation 的 `exhibit_label` 欄位 SHALL 更新為新的中文證物編號

#### Scenario: Reorder persists to database
- **WHEN** exhibit 重排觸發正文更新
- **THEN** 更新後的 content_structured（含 content_md 和 segments）SHALL 寫回 briefs 表

### Requirement: Swap-safe replacement avoids collision
重排替換 MUST 使用安全的替換策略，避免連鎖覆蓋（如甲證一→甲證二後，原本的甲證二又被改成甲證一時不會互相干擾）。

#### Scenario: Two-way swap without collision
- **WHEN** 甲證一和甲證二對調
- **THEN** SHALL 使用中間佔位符或 file_id-based 替換策略，確保兩個方向的替換不互相干擾

### Requirement: Only update paragraphs with matching citations
重排時 MUST 只更新含有受影響 file citation 的段落，不進行全域文字搜尋替換。

#### Scenario: Unrelated paragraphs unchanged
- **WHEN** exhibit 重排
- **THEN** 沒有對應 file citation 的段落（如前言、結論）SHALL 不被修改
