## ADDED Requirements

### Requirement: Zod schemas for all agent tool arguments
The system SHALL define a Zod schema for each agent tool's expected arguments in `src/server/schemas/tools.ts`. Schema fields SHALL match the `required` and `properties` defined in `definitions.ts` for each tool.

#### Scenario: Tool with required arguments validated
- **WHEN** the tool executor receives arguments for `read_file` (requires `file_id: string`)
- **THEN** the Zod schema validates that `file_id` is present and is a string before dispatching to the handler

#### Scenario: Tool with no arguments skips validation
- **WHEN** the tool executor receives arguments for `list_files` (no required args)
- **THEN** validation passes with an empty or any object (schema is `z.object({})`)

#### Scenario: Tool with optional arguments validated
- **WHEN** the tool executor receives arguments for `search_law` (required: `query`, optional: `law_name`, `limit`)
- **THEN** required fields are validated, optional fields use Zod `.optional()` and missing values are allowed

### Requirement: safeParseToolArgs utility function
The system SHALL provide a `safeParseToolArgs(toolName: string, raw: Record<string, unknown>, schema: ZodType): { success: true, data: T } | { success: false, error: string }` function that validates tool arguments without throwing.

#### Scenario: Valid tool arguments
- **WHEN** `safeParseToolArgs('read_file', { file_id: 'abc' }, readFileSchema)` is called
- **THEN** it returns `{ success: true, data: { file_id: 'abc' } }`

#### Scenario: Invalid tool arguments
- **WHEN** `safeParseToolArgs('read_file', {}, readFileSchema)` is called (missing `file_id`)
- **THEN** it returns `{ success: false, error: 'read_file 參數格式錯誤: file_id — Required' }`

### Requirement: Self-healing on validation failure
When tool argument validation fails, the tool executor SHALL return a `toolError` result instead of throwing. This allows the LLM to see the error message and retry with corrected arguments.

#### Scenario: Gemini sends malformed tool arguments
- **WHEN** Gemini calls `write_brief_section` with `relevant_file_ids` as a string instead of an array
- **THEN** the tool executor returns `{ result: 'write_brief_section 參數格式錯誤: relevant_file_ids — Expected array, received string', success: false }`
- **AND** the AgentDO tool loop continues (no throw/crash)
- **AND** Gemini sees the error in the tool result and can retry with correct arguments

#### Scenario: Validation failure does not crash AgentDO
- **WHEN** any tool argument validation fails
- **THEN** the AgentDO Durable Object does NOT throw an unhandled exception
- **AND** the SSE stream to the client remains open
- **AND** the tool loop continues with the error result fed back to the LLM

### Requirement: Tool executor integrates validation before dispatch
The `executeTool` function in `src/server/agent/tools/index.ts` SHALL validate arguments against the tool's Zod schema BEFORE calling the handler. If validation fails, it SHALL return `toolError` immediately without invoking the handler.

#### Scenario: Validation runs before handler
- **WHEN** `executeTool('read_file', { file_id: 123 }, ...)` is called (file_id should be string)
- **THEN** the `handleReadFile` function is NOT called
- **AND** `toolError` is returned with a descriptive message

#### Scenario: Schema registry maps tool names to schemas
- **WHEN** a new tool is added to the system
- **THEN** a corresponding Zod schema MUST be added to `schemas/tools.ts` and registered in the schema map, otherwise the tool executor SHALL log a warning and skip validation (graceful fallback)
