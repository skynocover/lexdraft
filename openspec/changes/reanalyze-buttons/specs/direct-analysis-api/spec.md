## ADDED Requirements

### Requirement: Analysis service layer
The system SHALL provide an `analysisService` module that encapsulates the core analysis logic (load files → call Gemini → persist results) independent of transport (SSE or HTTP response).

#### Scenario: Service returns analysis result
- **WHEN** `runAnalysis('disputes', caseId, db, drizzle, aiEnv)` is called
- **THEN** the service SHALL return `{ success: true, data: Dispute[], summary: string }` on success, or `{ success: false, error: string }` on failure

#### Scenario: Service does not send SSE
- **WHEN** service is called from API route
- **THEN** no SSE events SHALL be emitted; the caller is responsible for delivering results to the client

### Requirement: Analyze API endpoint
The system SHALL expose `POST /api/cases/:caseId/analyze` that accepts `{ type: 'disputes' | 'damages' | 'timeline' }` and returns analysis results synchronously.

#### Scenario: Successful disputes analysis
- **WHEN** POST with `{ type: 'disputes' }` and case has ready files
- **THEN** response SHALL be `200 { success: true, data: Dispute[], summary: string }` and disputes table SHALL be updated

#### Scenario: Successful damages analysis
- **WHEN** POST with `{ type: 'damages' }` and case has ready files
- **THEN** response SHALL be `200 { success: true, data: Damage[], summary: string }` and damages table SHALL be updated

#### Scenario: Successful timeline analysis
- **WHEN** POST with `{ type: 'timeline' }` and case has ready files
- **THEN** response SHALL be `200 { success: true, data: TimelineEvent[], summary: string }` and cases.timeline SHALL be updated

#### Scenario: Invalid type parameter
- **WHEN** POST with invalid or missing type
- **THEN** response SHALL be `400` with validation error

#### Scenario: No ready files
- **WHEN** POST but no files with status 'ready' exist for the case
- **THEN** response SHALL be `200 { success: false, error: '...' }` with descriptive message

#### Scenario: AI call failure
- **WHEN** Gemini API call fails
- **THEN** response SHALL be `500` with error message, and existing analysis data SHALL NOT be deleted

### Requirement: Agent tools use service layer
Existing agent tool handlers (`analyze_disputes`, `calculate_damages`, `generate_timeline`) SHALL be refactored to call the service layer, then send SSE events with the returned data.

#### Scenario: Agent tool calls service and sends SSE
- **WHEN** agent executes `analyze_disputes` tool
- **THEN** it SHALL call `runAnalysis('disputes', ...)`, then send `brief_update` SSE event with the returned data

### Requirement: Zod validation for analyze endpoint
The `POST /api/cases/:caseId/analyze` body SHALL be validated with a Zod v4 schema registered in `src/server/schemas/`.

#### Scenario: Schema validation
- **WHEN** request body is `{ type: 'disputes' }`
- **THEN** validation SHALL pass
- **WHEN** request body is `{ type: 'invalid' }`
- **THEN** validation SHALL fail with 400 error
