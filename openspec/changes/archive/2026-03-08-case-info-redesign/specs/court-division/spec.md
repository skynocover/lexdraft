## ADDED Requirements

### Requirement: Division field in database
`cases` table SHALL have a `division` TEXT column (nullable) to store the court division (庭別).

#### Scenario: Migration adds division column
- **WHEN** migration runs
- **THEN** `cases` table has a `division` column of type TEXT, nullable

### Requirement: Division dropdown with fixed options
CaseInfoTab SHALL provide a dropdown for 庭別 with 5 options from a DIVISIONS constant:
- 民事庭
- 刑事庭
- 簡易庭
- 家事庭
- 行政訴訟庭

Default selection SHALL be 民事庭.

#### Scenario: Division dropdown shows 5 options
- **WHEN** user clicks 庭別 dropdown
- **THEN** 5 division options are displayed

#### Scenario: New case defaults to 民事庭
- **WHEN** a case has no division set (null)
- **THEN** the dropdown displays 民事庭 as default

### Requirement: Division persisted via API
PATCH `/api/cases/:id` SHALL accept `division` field and persist to DB.

#### Scenario: Save division value
- **WHEN** user selects 刑事庭 and saves
- **THEN** `cases.division` is stored as '刑事庭'

### Requirement: Division in DIVISIONS constant
`src/shared/caseConstants.ts` SHALL export a `DIVISIONS` array with the 5 division options.

#### Scenario: DIVISIONS constant is available
- **WHEN** code imports DIVISIONS from caseConstants
- **THEN** it contains ['民事庭', '刑事庭', '簡易庭', '家事庭', '行政訴訟庭']

### Requirement: templateRenderer uses division
`CaseDataForRender` interface SHALL include `division: string | null`. `buildCaseDataBlock` SHALL include division in the case data block sent to Flash Lite.

#### Scenario: Division included in case data block
- **WHEN** templateRenderer builds case data with court='臺灣臺北地方法院' and division='民事庭'
- **THEN** the case data block includes `庭別：民事庭`

#### Scenario: Division is null
- **WHEN** templateRenderer builds case data with division=null
- **THEN** the case data block includes `庭別：（無）`
