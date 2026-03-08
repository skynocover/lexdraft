## ADDED Requirements

### Requirement: Zod schemas for all API route request bodies
The system SHALL define a Zod schema for every API route that accepts a JSON request body (POST/PUT/PATCH). Schemas SHALL be located in `src/server/schemas/` with one file per route domain.

#### Scenario: Valid request body passes validation
- **WHEN** a client sends a POST/PUT/PATCH request with a body that conforms to the route's Zod schema
- **THEN** the handler receives the parsed and typed data and proceeds normally

#### Scenario: Invalid request body fails validation
- **WHEN** a client sends a request body that fails Zod schema validation (missing required field, wrong type, etc.)
- **THEN** the system responds with HTTP 400 and body `{ error: "<first issue message>", details: [<ZodIssue[]>] }`

#### Scenario: Malformed JSON body
- **WHEN** a client sends a body that is not valid JSON
- **THEN** the system responds with HTTP 400 (Hono's built-in JSON parse error, before Zod validation)

### Requirement: parseBody utility function
The system SHALL provide a `parseBody<T>(raw: unknown, schema: ZodType<T>): T` function in `src/server/lib/validate.ts` that validates input against a Zod schema and throws `badRequest()` on failure.

#### Scenario: parseBody with valid input
- **WHEN** `parseBody(data, schema)` is called with data that passes schema validation
- **THEN** the function returns the parsed data with the Zod-inferred TypeScript type

#### Scenario: parseBody with invalid input
- **WHEN** `parseBody(data, schema)` is called with data that fails schema validation
- **THEN** the function throws `AppError(400)` with the first issue's message as the error string

### Requirement: Remove legacy validation functions
The system SHALL remove `requireString`, `requireNumber`, and `requireArray` from `src/server/lib/validate.ts` and all their call sites SHALL be replaced with Zod schema validation via `parseBody`.

#### Scenario: No legacy validation imports remain
- **WHEN** the migration is complete
- **THEN** no file in `src/server/` imports `requireString`, `requireNumber`, or `requireArray`

### Requirement: Error response format backward compatibility
API validation errors SHALL include the existing `error: string` field (first issue message). The `details` field with full `ZodIssue[]` SHALL be optional and only present on validation errors.

#### Scenario: Frontend error handling unchanged
- **WHEN** the frontend `api.ts` receives a 400 validation error
- **THEN** `err.error` contains a human-readable string, same as before the migration
