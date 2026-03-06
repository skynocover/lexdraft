## Why

現有文件分類系統（ours/theirs/court/evidence/other）需要透過 `client_role` 間接映射到證物 prefix（甲證/乙證），這層抽象對律師不直覺。律師必須理解「我方」在原告案件中等於「甲證」、在被告案件中等於「乙證」——但實務上律師一定知道自己是甲方還是乙方，直接選甲/乙更清楚。

同時，「我方」和「證據」兩個分類都映射到同一個 prefix，語義重疊。而「書狀」（起訴狀、答辯狀）在實務上不編為證物，目前卻被歸入 ours/theirs 並自動建立 exhibit，不符合法律實務。

## What Changes

- **分類從 5 類改為新 5 類**：`ours/theirs/court/evidence/other` → `brief/exhibit_a/exhibit_b/court/other`
- **移除 client_role 間接映射**：category 直接對應 exhibit prefix（exhibit_a→甲證, exhibit_b→乙證），不再需要 `getExhibitPrefix(clientRole, category)` 轉換
- **AI 分類 prompt 改寫**：傳入 client_role 讓 AI 在分類時直接判斷甲/乙，輸出新 category key
- **書狀不建立證物**：`brief` 類別（書狀）不自動建立 exhibit，與 court/other 相同
- **前端 badge 更新**：狀/甲/乙/法/他
- **舊資料相容**：已有的 ours/theirs/evidence category 值保持不動，前端 categoryConfig 加 fallback 顯示

## Capabilities

### New Capabilities
- `category-system`: 新的五分類系統定義（key、label、badge、exhibit 映射規則）

### Modified Capabilities

## Impact

- **後端**：`fileProcessor.ts`（AI prompt）、`exhibitAssign.ts`（prefix 映射）、`files.ts`（category 變更連動）
- **前端**：`categoryConfig.ts`（badge/label）、`FilesSection.tsx`（分組邏輯）、`FileItem.tsx`（popover 選項）
- **DB**：files 表的 category 欄位值域變更，但不需 migration（text 欄位）
- **舊資料**：不遷移，前端需處理舊 key 的 fallback 顯示
