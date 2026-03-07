## ADDED Requirements

### Requirement: CaseInfoTab grouped layout
CaseInfoTab SHALL display form fields in 3 groups with section headers:
1. **案件資訊**: 案件名稱、案號、法院、庭別
2. **當事人**: 我方立場（原告/被告）toggle + 原告/被告名稱
3. **AI 設定**: 書狀範本 + AI 處理指引

Each group SHALL have a text header (`text-xs font-medium text-t2`) and vertical spacing between groups.

#### Scenario: Groups are visually separated
- **WHEN** user views CaseInfoTab
- **THEN** three groups are visible with section headers: 案件資訊, 當事人, AI 設定

#### Scenario: Fields are in correct groups
- **WHEN** user views 案件資訊 group
- **THEN** it contains 案件名稱, 案號, 法院 dropdown, 庭別 dropdown

### Requirement: Court field uses shadcn Select
法院欄位 SHALL use shadcn `<Select>` component instead of native `<select>`, matching the style of the 書狀範本 selector.

#### Scenario: Court dropdown renders with shadcn Select
- **WHEN** user clicks the 法院 dropdown
- **THEN** a shadcn Select popover opens with 39 court options from COURTS constant

### Requirement: Court and division on same row
法院 and 庭別 dropdowns SHALL be displayed side-by-side on the same row using `grid-cols-2`.

#### Scenario: Layout is two-column for court and division
- **WHEN** user views 案件資訊 group
- **THEN** 法院 and 庭別 are on the same row, each taking half width

### Requirement: Case number on its own row
案號 input SHALL be displayed on its own full-width row, not sharing with 法院.

#### Scenario: Case number has full width
- **WHEN** user views 案件資訊 group
- **THEN** 案號 input spans the full width of the form
