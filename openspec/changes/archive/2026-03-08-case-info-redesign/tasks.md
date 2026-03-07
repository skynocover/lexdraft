## 1. DB + Shared Constants

- [x] 1.1 Add DIVISIONS constant to `src/shared/caseConstants.ts`
- [x] 1.2 Add `division` column to cases table in `src/server/db/schema.ts`
- [x] 1.3 Generate and apply Drizzle migration (`npm run db:generate && npm run db:migrate:local`)

## 2. API

- [x] 2.1 Update PATCH `/api/cases/:id` in `src/server/routes/cases.ts` to accept and persist `division`

## 3. Store

- [x] 3.1 Add `division` to case type and `updateCase` payload in `useCaseStore`

## 4. CaseInfoTab Redesign

- [x] 4.1 Restructure CaseInfoTab into 3 groups with section headers (案件資訊 / 當事人 / AI 設定)
- [x] 4.2 Move 案號 to its own full-width row
- [x] 4.3 Replace native `<select>` for 法院 with shadcn `<Select>`
- [x] 4.4 Add 庭別 shadcn `<Select>` dropdown next to 法院 (grid-cols-2)
- [x] 4.5 Wire division into FormData, dirty check, and handleSave

## 5. Pipeline Integration

- [x] 5.1 Add `division` to `CaseDataForRender` interface and `buildCaseDataBlock` in templateRenderer.ts
- [x] 5.2 Pass division from pipeline caller (where CaseDataForRender is constructed)

## 6. Verify

- [x] 6.1 Type-check (`npx tsc --noEmit`) and format (`npx prettier --write`)
