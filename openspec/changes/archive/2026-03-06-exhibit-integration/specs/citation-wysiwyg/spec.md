## ADDED Requirements

### Requirement: Citation displays as inline parenthesized text
Citation badges in the tiptap editor SHALL render as inline text at baseline vertical alignment with parentheses, matching the Word export format. File citations SHALL display `（exhibitLabel）` when an exhibit is assigned, or `（filename）` as fallback. Law citations SHALL display `（lawLabel）`.

#### Scenario: File citation with exhibit assigned
- **WHEN** a file citation is rendered in the editor and the file has an exhibit (e.g., 甲證1)
- **THEN** the badge displays `（甲證1）` at normal text size, inline with surrounding text

#### Scenario: File citation without exhibit
- **WHEN** a file citation is rendered in the editor and the file has no exhibit assigned
- **THEN** the badge displays `（filename）` using the original file label

#### Scenario: Law citation
- **WHEN** a law citation is rendered in the editor
- **THEN** the badge displays `（民法第184條第1項前段）` at normal text size, inline with surrounding text

#### Scenario: Hover popover unchanged
- **WHEN** user hovers over any citation (file or law)
- **THEN** the existing popover with quoted text, source info, and action buttons SHALL appear unchanged

#### Scenario: Exhibit label updates in real-time
- **WHEN** an exhibit's number or prefix is changed (via reorder or edit)
- **THEN** all citation badges referencing that file SHALL immediately reflect the new label without page refresh
