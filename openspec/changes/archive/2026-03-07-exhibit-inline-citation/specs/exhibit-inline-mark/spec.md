## ADDED Requirements

### Requirement: File citations render as inline text marks
正文中的證物編號文字（如「甲證一」）SHALL 渲染為 Tiptap ExhibitMark，具有藍色底色/超連結風格，與周圍正文融為一體。法條 citations SHALL 維持現有 CitationNode badge 不變。

#### Scenario: Content section with file citation renders exhibit mark
- **WHEN** 段落 content_md 包含「有鑑定意見書可稽（甲證二）」且段落 citations 含有 type=file 的 citation
- **THEN** 「甲證二」文字 SHALL 套用 ExhibitMark（藍色底色），括號和其餘文字為一般樣式

#### Scenario: Law citation still renders as badge
- **WHEN** 段落 citations 含有 type=law 的 citation
- **THEN** SHALL 維持現有 CitationNode badge 渲染方式，不受 ExhibitMark 影響

#### Scenario: File citation without matching text in content_md
- **WHEN** 段落有 file citation 但 content_md 中找不到對應的證物編號文字
- **THEN** SHALL fallback 為在段尾插入「（甲證X）」文字並套用 ExhibitMark

### Requirement: ExhibitMark provides hover and click interaction
ExhibitMark MUST 支援 hover 顯示 popover（引文原文、來源位置）和 click 開啟來源檔案，功能等同現有 CitationNodeView。

#### Scenario: Hover on exhibit mark shows popover
- **WHEN** 使用者 hover 正文中的「甲證一」文字（已套用 ExhibitMark）
- **THEN** SHALL 顯示 popover，包含：文件類型 badge、證物編號 label、引文原文（quoted_text）、「開啟來源文件」按鈕

#### Scenario: Click opens source file tab
- **WHEN** 使用者點擊 popover 的「開啟來源文件」按鈕
- **THEN** SHALL 在另一面板開啟對應檔案 tab（同現有 CitationNodeView 行為）

### Requirement: Word export does not duplicate exhibit references
`exportDocx.ts` 對 file type citation MUST NOT 再插入「（甲證X）」括號文字，因正文已包含證物編號。

#### Scenario: Word export with exhibit references in text
- **WHEN** 匯出 Word，段落正文已包含「（甲證一）」且有對應 file citation
- **THEN** file citation marker SHALL 輸出為空字串，不產生重複的「（甲證一）」

#### Scenario: Law citation export unchanged
- **WHEN** 匯出 Word，段落有 law citation
- **THEN** law citation marker SHALL 維持現有格式輸出（法條名稱文字）

### Requirement: Chinese numeral exhibit labels in brief text
正文中的證物編號 MUST 使用中文數字格式（甲證一、甲證二），不使用阿拉伯數字（甲證1）。

#### Scenario: Exhibit label format in content
- **WHEN** pipeline 產出書狀正文或渲染 ExhibitMark
- **THEN** 證物編號 SHALL 使用中文數字（如「甲證一」），不使用「甲證1」

#### Scenario: ExhibitsTab UI retains short format
- **WHEN** ExhibitsTab 顯示證物列表
- **THEN** SHALL 維持現有簡寫格式「甲1」、「甲2」
