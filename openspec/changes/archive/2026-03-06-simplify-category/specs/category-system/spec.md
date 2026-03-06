## ADDED Requirements

### Requirement: Five-category classification system
The system SHALL classify uploaded files into exactly five categories: `brief`, `exhibit_a`, `exhibit_b`, `court`, `other`.

#### Scenario: AI classifies a plaintiff's brief
- **WHEN** a file containing "民事起訴狀" is uploaded
- **THEN** the system SHALL assign category `brief`

#### Scenario: AI classifies evidence for plaintiff side
- **WHEN** a file containing evidence (e.g., diagnosis certificate) is uploaded and client_role is `plaintiff`
- **THEN** the system SHALL assign category `exhibit_a`

#### Scenario: AI classifies evidence for defendant side
- **WHEN** a file containing evidence is uploaded and client_role is `defendant`
- **THEN** the system SHALL assign category `exhibit_b`

#### Scenario: AI classifies opponent's evidence when client is plaintiff
- **WHEN** a file identified as opposing party's evidence is uploaded and client_role is `plaintiff`
- **THEN** the system SHALL assign category `exhibit_b`

#### Scenario: AI classifies court document
- **WHEN** a file containing court records (e.g., "筆錄", "裁定") is uploaded
- **THEN** the system SHALL assign category `court`

### Requirement: Direct category-to-prefix mapping
The system SHALL map category to exhibit prefix without requiring client_role: `exhibit_a` → `甲證`, `exhibit_b` → `乙證`. Categories `brief`, `court`, `other` SHALL NOT create exhibits.

#### Scenario: exhibit_a file gets exhibit assigned
- **WHEN** a file with category `exhibit_a` is processed for exhibit assignment
- **THEN** the system SHALL create an exhibit with prefix `甲證`

#### Scenario: brief file does not get exhibit
- **WHEN** a file with category `brief` is processed for exhibit assignment
- **THEN** the system SHALL NOT create an exhibit

### Requirement: Category change syncs exhibit prefix
When a file's category is changed via the API, the system SHALL update or remove the corresponding exhibit to match the new category's prefix mapping.

#### Scenario: Change from exhibit_a to exhibit_b
- **WHEN** a file's category is changed from `exhibit_a` to `exhibit_b`
- **THEN** the system SHALL move the exhibit from `甲證` to `乙證` with the next available number, and renumber the old prefix group

#### Scenario: Change from exhibit_a to court
- **WHEN** a file's category is changed from `exhibit_a` to `court`
- **THEN** the system SHALL delete the exhibit and renumber the remaining `甲證` exhibits

#### Scenario: Change from court to exhibit_a
- **WHEN** a file's category is changed from `court` to `exhibit_a`
- **THEN** the system SHALL create a new exhibit with prefix `甲證` and the next available number

### Requirement: Frontend displays five category badges
The frontend SHALL display category badges: 狀 (brief), 甲 (exhibit_a), 乙 (exhibit_b), 法 (court), 他 (other).

#### Scenario: User sees category badge
- **WHEN** a file with category `exhibit_a` is displayed in the sidebar
- **THEN** the system SHALL show a badge with text "甲"

#### Scenario: User changes category via popover
- **WHEN** user clicks the category badge and selects a new category
- **THEN** the system SHALL update the file's category and sync the exhibit accordingly

### Requirement: Legacy category fallback display
The frontend SHALL display legacy category keys (ours, theirs, evidence) with distinguishable badges so existing data remains readable.

#### Scenario: File with legacy category ours
- **WHEN** a file has category `ours` (from before this change)
- **THEN** the system SHALL display it with a "我" badge
