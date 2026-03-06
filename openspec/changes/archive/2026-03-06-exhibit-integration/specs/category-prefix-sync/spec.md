## ADDED Requirements

### Requirement: Category change syncs exhibit prefix
When a file's category is changed via the category badge popover, and that file has an exhibit, the exhibit's prefix SHALL be automatically updated based on the new category and the case's clientRole using `getExhibitPrefix()`. Both the old and new prefix groups SHALL be renumbered.

#### Scenario: Plaintiff changes file from ours to theirs
- **WHEN** clientRole is plaintiff, and user changes a file's category from ours to theirs
- **THEN** the file's exhibit prefix changes from 甲證 to 乙證, and both groups renumber

#### Scenario: Category with no exhibit mapping
- **WHEN** user changes a file's category to court or other (which return null from getExhibitPrefix)
- **THEN** the exhibit is removed, and the original prefix group renumbers

#### Scenario: File without exhibit
- **WHEN** user changes category on a file that has no exhibit
- **THEN** only the file's category is updated, no exhibit changes

#### Scenario: Toast notification on prefix change
- **WHEN** a category change triggers an exhibit prefix update
- **THEN** a toast notification displays informing the user of the exhibit change
