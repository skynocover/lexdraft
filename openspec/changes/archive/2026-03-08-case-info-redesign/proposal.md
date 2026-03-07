## Why

CaseInfoTab 目前為扁平表單，法院與案號擠在同一行，且缺少「庭別」欄位。書狀 header/footer 的管轄法院經常錯誤或空白，因為 `cases.court` 在 pipeline 執行時常未填寫，且沒有庭別資訊可組合出完整的法院全稱（如「臺灣臺北地方法院　民事庭　公鑒」）。

## What Changes

- CaseInfoTab 從扁平表單重構為 3 個分組：案件資訊、當事人、AI 設定
- 法院改為 dropdown（從 COURTS 常數選取），庭別新增 dropdown（民事庭/刑事庭/簡易庭/家事庭/行政訴訟庭，預設民事庭）
- 法院 + 庭別同一行排列，案號獨立一行（解決目前擠在一起的問題）
- 書狀範本從案件資訊移至 AI 設定分組
- DB `cases` 表新增 `division` 欄位
- templateRenderer 組合 `{court}　{division}　公鑒` 產生完整法院標題

## Capabilities

### New Capabilities
- `case-info-layout`: CaseInfoTab 分組佈局（3 組：案件資訊、當事人、AI 設定）與庭別 dropdown
- `court-division`: DB division 欄位、API 支援、templateRenderer 整合

### Modified Capabilities

## Impact

- **Frontend**: `src/client/components/layout/sidebar/CaseInfoTab.tsx` 重構
- **Shared**: `src/shared/caseConstants.ts` 新增 DIVISIONS 常數
- **DB**: `src/server/db/schema.ts` cases 表新增 division 欄位 + migration
- **API**: `src/server/routes/cases.ts` PATCH 支援 division
- **Pipeline**: `src/server/agent/pipeline/templateRenderer.ts` 使用 division
