## ADDED Requirements

### Requirement: Files list sorted by exhibit number
FilesSection SHALL sort files with exhibits first (甲證 group → 乙證 group, each sorted by number ASC), followed by unassigned files sorted by category.

#### Scenario: Mixed files with and without exhibits
- **WHEN** a case has files with exhibits (甲證1, 甲證2, 乙證1) and files without exhibits (court document)
- **THEN** the list displays: 甲方證物 section header → 甲證1 → 甲證2 → 乙方證物 section header → 乙證1 → 未編號 section header → court document

#### Scenario: No exhibits assigned
- **WHEN** no files have exhibits
- **THEN** files display in existing category order without section headers

### Requirement: Drag reorder within same prefix
Files with exhibits SHALL be draggable within the same prefix group to reorder their exhibit numbers. Drag reorder SHALL call the existing `PATCH /api/cases/:caseId/exhibits/reorder` API.

#### Scenario: Reorder within 甲證
- **WHEN** user drags 甲證1 below 甲證2
- **THEN** the items renumber to 甲證1 (was 甲證2) and 甲證2 (was 甲證1), and the reorder API is called

#### Scenario: Cannot drag across prefix groups
- **WHEN** user attempts to drag a 甲證 item into the 乙證 group
- **THEN** the drag is constrained to the same prefix group

#### Scenario: Unassigned files not draggable
- **WHEN** a file has no exhibit assigned
- **THEN** no drag handle is rendered and the file cannot be dragged

### Requirement: Exhibit label displayed on file item
FileItem SHALL display the exhibit label (e.g., 甲證1) on the right side when the file has an exhibit assigned.

#### Scenario: File with exhibit
- **WHEN** a file has an exhibit with prefix 甲證 and number 1
- **THEN** the FileItem displays `甲證1` label on the right side

#### Scenario: File without exhibit
- **WHEN** a file has no exhibit
- **THEN** no exhibit label is rendered

### Requirement: Doc type inline select
FileItem SHALL display an inline select for doc_type (影本/正本/繕本) when the file has an exhibit. Changing the select SHALL call `PATCH /api/cases/:caseId/exhibits/:id`.

#### Scenario: Change doc type
- **WHEN** user changes doc_type select from 影本 to 正本
- **THEN** the exhibit's doc_type is updated via API

### Requirement: Exhibit label editable via popover
Clicking the exhibit label on a FileItem SHALL open a Popover where the user can change the prefix (甲證/乙證) and number. This serves as an escape hatch when auto-assignment is wrong.

#### Scenario: Change prefix
- **WHEN** user clicks 甲證1 label → changes prefix to 乙證 in popover
- **THEN** the exhibit moves to 乙證 group with the next available number, and both prefix groups renumber

#### Scenario: Change number
- **WHEN** user clicks 甲證2 label → changes number to 1 in popover
- **THEN** the exhibit becomes 甲證1 and the previous 甲證1 shifts to 甲證2

### Requirement: ExhibitsTab removed
The ExhibitsTab component and its analysis panel sub-tab SHALL be removed. The exhibits sub-tab entry in useUIStore SHALL be removed.

#### Scenario: Analysis panel tabs
- **WHEN** user views the analysis panel
- **THEN** there is no 證物 tab
