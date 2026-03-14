## ADDED Requirements

### Requirement: TemplateEditor 工具列顯示書狀性質

自訂模板的 TemplateEditor 工具列 SHALL 顯示當前 `brief_mode` 的下拉選單，允許修改。

#### Scenario: 自訂模板顯示下拉選單
- **WHEN** 開啟自訂模板的 TemplateEditor
- **THEN** 工具列 SHALL 顯示「性質：」標籤和下拉選單，顯示當前 `brief_mode` 對應的中文標籤

#### Scenario: 系統預設模板不顯示
- **WHEN** 開啟系統預設模板的 TemplateEditor
- **THEN** 工具列 SHALL 不顯示書狀性質下拉選單（系統模板為唯讀）

#### Scenario: 修改 briefMode 觸發儲存
- **WHEN** 使用者在下拉選單中選擇不同的書狀性質
- **THEN** SHALL 更新 store 中的 `brief_mode` 並觸發 auto-save（與現有 content/title 的 auto-save 機制一致）

#### Scenario: 下拉選單選項
- **WHEN** 下拉選單展開
- **THEN** SHALL 顯示五個選項，使用與建立 Dialog 相同的中文標籤：提出請求、回應對方、補充攻防、挑戰裁判、聲請法院
