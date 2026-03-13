## ADDED Requirements

### Requirement: Tab bar 顯示三個核心分析 tab
Tab bar SHALL 顯示三個帶 icon + 文字標籤的核心 tab：「爭點」（Swords）、「卷宗」（FolderOpen）、「時序」（Clock），左對齊排列。

#### Scenario: Tab bar 預設渲染
- **WHEN** sidebar 開啟
- **THEN** tab bar 依序顯示「⚔️ 爭點」「📁 卷宗」「🕐 時序」三個 tab，每個 tab 含 icon 和文字標籤

#### Scenario: 點擊 tab 切換內容
- **WHEN** 使用者點擊任一核心 tab
- **THEN** tab 進入 active 狀態（accent 色底線 + accent 文字色），對應內容面板顯示

### Requirement: 案件資訊以 icon 按鈕呈現
案件資訊入口 SHALL 以單一 Info icon 按鈕呈現，位於 tab bar 右側、收合按鈕左側，不帶文字標籤。

#### Scenario: 案件資訊 icon 位置
- **WHEN** sidebar 開啟
- **THEN** tab bar 右側顯示 Info icon 按鈕，緊鄰收合按鈕（ChevronsRight）

#### Scenario: 點擊案件資訊 icon
- **WHEN** 使用者點擊 Info icon
- **THEN** sidebar 切換到案件資訊面板（CaseInfoTab），icon 顯示 active 高亮（text-ac）

#### Scenario: 案件資訊 active 時再次點擊
- **WHEN** 案件資訊面板已顯示，使用者再次點擊 Info icon
- **THEN** 行為與其他 tab 一致（維持顯示，不做切換）

### Requirement: SidebarTab type 包含 timeline
`SidebarTab` union type SHALL 包含 `'timeline'` 值，完整為 `'case-info' | 'disputes' | 'case-materials' | 'timeline'`。

#### Scenario: 設定 sidebarTab 為 timeline
- **WHEN** 呼叫 `setSidebarTab('timeline')`
- **THEN** store 狀態更新為 `sidebarTab: 'timeline'`，TypeScript 編譯通過
