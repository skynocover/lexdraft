## ADDED Requirements

### Requirement: Section Collapsible 統一模式
資訊缺口和不爭執事項 SHALL 使用相同的 Collapsible 元件模式，包含：icon、標題文字、數量 badge、ChevronRight 展開指示。兩者 SHALL 預設收合。

#### Scenario: 資訊缺口預設收合
- **WHEN** DisputesTab 載入且有資訊缺口資料
- **THEN** 資訊缺口 section 顯示為收合狀態，僅顯示 header 一行（⚠ 資訊缺口 (N) ▸）

#### Scenario: 不爭執事項預設收合
- **WHEN** DisputesTab 載入且有不爭執事項資料
- **THEN** 不爭執事項 section 顯示為收合狀態，僅顯示 header 一行（✓ 不爭執事項 (N) ▸）

#### Scenario: 點擊展開/收合
- **WHEN** 使用者點擊 section header
- **THEN** section 內容展開或收合，ChevronRight 旋轉 90 度對應狀態

### Requirement: 佈局順序為資訊缺口 → 爭點 → 不爭執事項
DisputesTab SHALL 以「資訊缺口 → 爭點卡片 → 不爭執事項」的順序排列內容。

#### Scenario: 爭點卡片在收合狀態下立刻可見
- **WHEN** 資訊缺口和不爭執事項皆為收合狀態
- **THEN** 爭點卡片不需捲動即可看到（位於兩個收合 section 之間）

### Requirement: Card 呈現取代條列式
資訊缺口的每個 gap 和不爭執事項的每個 fact SHALL 以獨立 card 呈現，取代現有的 bullet list 和 checkmark list。

#### Scenario: 資訊缺口展開顯示 gap cards
- **WHEN** 使用者展開資訊缺口 section
- **THEN** 每個 gap 顯示為獨立 card，文字截斷為單行

#### Scenario: 不爭執事項展開顯示 fact cards
- **WHEN** 使用者展開不爭執事項 section
- **THEN** 每個 fact 顯示為獨立 card，文字截斷為單行

### Requirement: Tooltip 顯示完整文字
截斷的 card SHALL 在 hover 時透過 Tooltip 顯示完整文字。

#### Scenario: Hover gap card 顯示全文
- **WHEN** 使用者 hover 一張資訊缺口 card
- **THEN** 顯示 Tooltip 包含該 gap 的完整文字

#### Scenario: Hover fact card 顯示全文
- **WHEN** 使用者 hover 一張不爭執事項 card
- **THEN** 顯示 Tooltip 包含該 fact 的完整文字

### Requirement: 移除 dismiss (X) 機制
資訊缺口 SHALL 不再有 dismiss (X) 按鈕，改由 Collapsible 收合取代。

#### Scenario: 資訊缺口無 X 按鈕
- **WHEN** 資訊缺口 section 顯示
- **THEN** 不存在 dismiss (X) 按鈕，僅有 Collapsible 展開/收合功能

### Requirement: 資訊缺口和不爭執事項空資料時不顯示
當資訊缺口為空陣列或不爭執事項為空陣列時，對應的 section SHALL 不渲染。

#### Scenario: 無資訊缺口時不顯示 section
- **WHEN** `informationGaps` 為空陣列
- **THEN** 資訊缺口 section 完全不渲染

#### Scenario: 無不爭執事項時不顯示 section
- **WHEN** `undisputedFacts` 為空陣列
- **THEN** 不爭執事項 section 完全不渲染
