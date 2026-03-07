## ADDED Requirements

### Requirement: Brief config per type
briefAssembler SHALL maintain a config object for each supported brief_type (`complaint`, `defense`, `preparation`, `appeal`), containing: brief title, party labels, whether declaration exists, declaration type, court suffix, and whether case number is required.

#### Scenario: Complaint config
- **WHEN** briefType is `complaint`
- **THEN** config SHALL have title `民事起訴狀`, partyLabels `['原告', '被告']`, declaration type `claim`, courtSuffix `民事庭`

#### Scenario: Defense config
- **WHEN** briefType is `defense`
- **THEN** config SHALL have title `民事答辯狀`, partyLabels `['原告', '被告']`, declaration type `dismiss`, courtSuffix `民事庭`

#### Scenario: Preparation config
- **WHEN** briefType is `preparation`
- **THEN** config SHALL have title `民事準備書狀`, declaration `null` (no declaration section), courtSuffix `民事庭`

#### Scenario: Appeal config
- **WHEN** briefType is `appeal`
- **THEN** config SHALL have title `上訴狀`, partyLabels `['上訴人', '被上訴人']`, declaration type `appeal`, courtSuffix `民事庭`

### Requirement: Assemble header
assembleHeader SHALL produce Paragraph(s) containing: brief title, case number (if available), and party information using the correct labels for the brief type.

#### Scenario: Full case data
- **WHEN** caseRow has court `高雄地方法院`, case_number `114年度雄簡字第123號`, plaintiff `艾凡尼國際有限公司`, defendant `朱立家`, and briefType is `complaint`
- **THEN** header SHALL include `民事起訴狀`, case number, and parties labeled as `原告` and `被告`

#### Scenario: Missing fields
- **WHEN** caseRow has plaintiff `null` and defendant `null`
- **THEN** header SHALL omit party lines, not produce empty lines or placeholders

#### Scenario: New case no number
- **WHEN** briefType is `complaint` and case_number is null
- **THEN** header SHALL show case number line as `案號：（新案免填）`

### Requirement: Assemble declaration
assembleDeclaration SHALL produce Paragraph(s) for the declaration section based on brief_type and damages data.

#### Scenario: Complaint with damages
- **WHEN** briefType is `complaint` and damages table has items totaling NT$423,700
- **THEN** declaration SHALL produce a `壹、訴之聲明` section containing:
  1. 被告應給付原告新臺幣423,700元，及自起訴狀繕本送達翌日起至清償日止，按年息百分之五計算之利息
  2. 訴訟費用由被告負擔
  3. 原告願供擔保，請准宣告假執行

#### Scenario: Complaint without damages
- **WHEN** briefType is `complaint` and damages is empty
- **THEN** declaration SHALL produce a generic declaration without specific amount (placeholder for lawyer to fill)

#### Scenario: Defense
- **WHEN** briefType is `defense`
- **THEN** declaration SHALL produce `壹、答辯聲明` containing:
  1. 原告之訴駁回
  2. 訴訟費用由原告負擔
  3. 如受不利判決，被告願供擔保請准宣告免為假執行

#### Scenario: Preparation
- **WHEN** briefType is `preparation`
- **THEN** declaration SHALL return empty array (no declaration section)

#### Scenario: Appeal
- **WHEN** briefType is `appeal`
- **THEN** declaration SHALL produce `壹、上訴聲明` containing a generic appeal declaration template

#### Scenario: Damages total calculation
- **WHEN** damages table has a row with description containing `總計`
- **THEN** assembler SHALL use that row's amount as total, not re-sum all rows

#### Scenario: Damages without total row
- **WHEN** damages table has no row with description containing `總計`
- **THEN** assembler SHALL sum all damage amounts as total

### Requirement: Assemble footer
assembleFooter SHALL produce Paragraph(s) for the brief closing section.

#### Scenario: Complaint footer
- **WHEN** briefType is `complaint`, court is `高雄地方法院`, plaintiff is `艾凡尼國際有限公司`
- **THEN** footer SHALL contain `謹　狀`, `臺灣高雄地方法院　民事庭　公鑒`, and `具狀人：艾凡尼國際有限公司`

#### Scenario: Defense footer
- **WHEN** briefType is `defense`, defendant is `王建宏`
- **THEN** footer signatory SHALL be the defendant name

#### Scenario: Missing court
- **WHEN** court is null
- **THEN** footer SHALL use generic `○○地方法院　民事庭　公鑒`

### Requirement: Pipeline integration
briefPipeline SHALL insert assembled paragraphs before and after AI-generated body paragraphs.

#### Scenario: Complete brief assembly order
- **WHEN** pipeline completes Step 3 Writer
- **THEN** final content_structured.paragraphs SHALL be ordered: header paragraphs, declaration paragraphs, AI body paragraphs, footer paragraphs

#### Scenario: Preparation brief (no declaration)
- **WHEN** briefType is `preparation`
- **THEN** final paragraphs SHALL be: header, AI body, footer (no declaration)

### Requirement: AI body numbering alignment
BRIEF_STRUCTURE_CONVENTIONS SHALL use section numbers that follow after the assembler's declaration section.

#### Scenario: Complaint numbering
- **WHEN** briefType is `complaint` (declaration is 壹)
- **THEN** AI body sections SHALL start from 貳（前言）, 參（事實及理由）, etc.

#### Scenario: Preparation numbering
- **WHEN** briefType is `preparation` (no declaration)
- **THEN** AI body sections SHALL start from 壹（前言）as before (no change)
