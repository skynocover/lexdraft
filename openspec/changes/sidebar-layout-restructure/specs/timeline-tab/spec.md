## ADDED Requirements

### Requirement: 時間軸獨立 tab 面板
選擇「時序」tab 時，sidebar SHALL 顯示獨立的時間軸面板，內容複用 `TimelineTab` 元件。

#### Scenario: 顯示時間軸內容
- **WHEN** 使用者點擊「時序」tab
- **THEN** sidebar 內容區顯示 TimelineTab 元件，含 header row（事件數量 + reanalyze 按鈕）和時間軸事件列表

#### Scenario: 時間軸為空
- **WHEN** 使用者點擊「時序」tab 且尚無時間軸資料
- **THEN** 顯示空狀態 UI（icon + 提示文字 + EmptyAnalyzeButton）

### Requirement: 時間軸從爭點 tab 移除
爭點 tab（DisputesTab）SHALL 不再包含時間軸的 Collapsible 區塊。

#### Scenario: 爭點 tab 不顯示時間軸
- **WHEN** 使用者檢視爭點 tab
- **THEN** 頁面內容為：爭點數量 header → 資訊缺口 → 爭點卡片列表 → 不爭執事項 → 請求總額（不含時間軸 Collapsible）
