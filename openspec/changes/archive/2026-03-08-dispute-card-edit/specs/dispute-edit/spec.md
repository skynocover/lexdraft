## ADDED Requirements

### Requirement: Update dispute title via API

The system SHALL provide `PATCH /api/cases/:caseId/disputes/:id` that updates the dispute title.

#### Scenario: Successful title update
- **WHEN** a PATCH request is sent with `{ title: "新標題" }`
- **THEN** the dispute's title is updated in the database and the response returns the updated dispute

#### Scenario: Empty title rejected
- **WHEN** a PATCH request is sent with `{ title: "" }` or missing title
- **THEN** the response returns 400 error

### Requirement: Delete dispute via API with cascade

The system SHALL provide `DELETE /api/cases/:caseId/disputes/:id` that deletes the dispute and all claims with matching `dispute_id`.

#### Scenario: Successful deletion with claims
- **WHEN** a DELETE request is sent for a dispute that has 3 associated claims
- **THEN** all 3 claims are deleted first, then the dispute is deleted, and the response returns 204

#### Scenario: Deletion does not affect briefs
- **WHEN** a dispute is deleted that has brief paragraphs referencing its `dispute_id`
- **THEN** the brief paragraphs remain unchanged

### Requirement: Inline title editing on DisputeCard

DisputeCard SHALL support inline title editing triggered by a hover edit button.

#### Scenario: Enter edit mode
- **WHEN** user hovers on the dispute card header and clicks the edit (Pencil) button
- **THEN** the title text becomes an editable input field pre-filled with the current title

#### Scenario: Save edit with Enter
- **WHEN** user presses Enter in the title input
- **THEN** the API is called to update the title and the card returns to display mode

#### Scenario: Cancel edit with Escape
- **WHEN** user presses Escape in the title input
- **THEN** the edit is discarded and the card returns to display mode with the original title

### Requirement: Delete dispute from DisputeCard

DisputeCard SHALL support deletion triggered by a hover delete button with confirmation.

#### Scenario: Delete with confirmation
- **WHEN** user hovers on the dispute card header and clicks the delete (Trash2) button
- **THEN** a ConfirmDialog is shown, and upon confirmation the dispute and its claims are deleted

#### Scenario: Cancel deletion
- **WHEN** user clicks cancel in the ConfirmDialog
- **THEN** nothing is deleted
