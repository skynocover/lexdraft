# Design: 證物編號系統

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Pipeline 完成                                                   │
│  paragraphs[] with citations                                    │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  assignExhibits() — 純 JS，零 token                             │
│                                                                  │
│  1. 掃描 citations (type='file') → 收集 unique file_ids         │
│     按首次出現順序（paragraph index → segment index → citation） │
│                                                                  │
│  2. 查已有 exhibits → 過濾掉已編號的 file_ids                    │
│                                                                  │
│  3. 查 case.client_role + file.category → 決定 prefix           │
│     已有編號的最大 number → 新 file 接續                          │
│                                                                  │
│  4. INSERT 新 exhibits 記錄                                      │
│                                                                  │
│  5. SSE event: set_exhibits（全量推送）                           │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Frontend — Render-time mapping                                  │
│                                                                  │
│  exhibitMap: Map<file_id, '甲證1'>  ← 從 exhibits 表建立        │
│                                                                  │
│  ┌── CitationNodeView ─────┐  ┌── 證物清單 Tab ──────────────┐  │
│  │ popover: 顯示 exhibit   │  │ 排序（更新 number）          │  │
│  │ label 或 fallback 檔名  │  │ 編輯 doc_type / description  │  │
│  │                         │  │ 新增（從 files 選取）         │  │
│  │ click → FileViewer      │  │ 刪除                          │  │
│  └─────────────────────────┘  │ 匯出證物清單                  │  │
│                                └──────────────────────────────┘  │
│  ┌── exportDocx ───────────┐                                     │
│  │ 用 exhibitMap 替換 label│                                     │
│  └─────────────────────────┘                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Data Model

### New Table: `exhibits`

```typescript
// src/server/db/schema.ts
export const exhibits = sqliteTable('exhibits', {
  id: text('id').primaryKey(),
  case_id: text('case_id')
    .notNull()
    .references(() => cases.id),
  file_id: text('file_id')
    .notNull()
    .references(() => files.id),
  prefix: text('prefix'),        // '甲證' | '乙證' | null
  number: integer('number'),     // 1, 2, 3...
  doc_type: text('doc_type').default('影本'),
  description: text('description'),
  created_at: text('created_at'),
});
```

Unique constraint: `UNIQUE(case_id, file_id)` — 一個案件內同一個 file 只能有一個 exhibit。

Computed label: `${prefix}${number}`（如 `甲證1`），不存欄位，需要時計算。

## API Design

### Routes: `src/server/routes/exhibits.ts`

```
GET    /api/cases/:caseId/exhibits
       → Exhibit[] (sorted by prefix, number)

POST   /api/cases/:caseId/exhibits
       → Body: { file_id, prefix? }
       → 手動新增 exhibit（接續該 prefix 的最大 number）

PATCH  /api/cases/:caseId/exhibits/:id
       → Body: { prefix?, number?, doc_type?, description? }
       → 更新單一 exhibit

PATCH  /api/cases/:caseId/exhibits/reorder
       → Body: { prefix: string, order: string[] }
       → 同一 prefix 內重新排序（order 是 exhibit id 陣列，index+1 = 新 number）

DELETE /api/cases/:caseId/exhibits/:id
       → 刪除 exhibit + 同 prefix 剩餘 exhibits 重新編號
```

## Core Logic

### `assignExhibits()` — 自動分配函式

位置：`src/server/lib/exhibitAssign.ts`

```
Input:
  - paragraphs: Paragraph[]
  - clientRole: 'plaintiff' | 'defendant'
  - files: { id, category }[]
  - existingExhibits: Exhibit[]  ← 已有的 case-level exhibits

Output:
  - newExhibits: { file_id, prefix, number }[]

Algorithm:
  1. Build existingFileIds = Set(existingExhibits.map(e => e.file_id))
     Build maxNumbers = { '甲證': max甲, '乙證': max乙 } from existingExhibits

  2. Walk paragraphs in order
     For each paragraph → segments → citations:
       If citation.type === 'file'
         && citation.file_id not in existingFileIds
         && citation.file_id not yet seen in this run:
           Add to newFileIds[]

  3. For each file_id in newFileIds:
     prefix = getExhibitPrefix(clientRole, file.category)
     If prefix is null (court/other): skip
     number = ++maxNumbers[prefix]
     Emit { file_id, prefix, number }
```

### `getExhibitPrefix()` — prefix 決定矩陣

```typescript
const getExhibitPrefix = (
  clientRole: 'plaintiff' | 'defendant',
  fileCategory: string | null,
): string | null => {
  if (fileCategory === 'court' || fileCategory === 'other' || !fileCategory) return null;
  const isOurSide = fileCategory === 'ours' || fileCategory === 'evidence';
  if (clientRole === 'plaintiff') return isOurSide ? '甲證' : '乙證';
  return isOurSide ? '乙證' : '甲證';
};
```

## Pipeline Integration

在 pipeline Step 3 完成所有 sections 後：

```
Step 3: writeSection() × N sections
  ↓
cleanupUncitedLaws()        ← 已有
  ↓
assignExhibits()            ← 新增
  ↓
Save brief to DB
  ↓
SSE: set_exhibits           ← 推送 exhibits 全量到前端
```

### SSE Event

```typescript
{
  type: 'brief_update',
  brief_id: string,         // 觸發的 brief（用於 context，實際 exhibits 是 case-level）
  action: 'set_exhibits',
  data: Exhibit[]            // case 的全部 exhibits
}
```

## Frontend Design

### Exhibit Map（核心 mapping）

```typescript
// useBriefStore 或獨立 computed
const exhibitMap = useMemo(() => {
  const map = new Map<string, string>(); // file_id → '甲證1'
  for (const e of exhibits) {
    if (e.prefix && e.number) {
      map.set(e.file_id, `${e.prefix}${e.number}`);
    }
  }
  return map;
}, [exhibits]);
```

### 需要注入 exhibitMap 的地方

| 檔案 | 改動 |
|------|------|
| `CitationNodeView.tsx` | popover header：`exhibitMap.get(fileId) \|\| label` |
| `CitationReviewModal.tsx` | 同上，顯示 exhibit label |
| `exportDocx.ts` | `buildCitationText(exhibitMap.get(c.file_id) \|\| c.label)` |

badge 顯示（`{index != null ? index + 1 : label}`）：如果想讓 inline badge 也顯示證物編號而非數字，可調整為 `exhibitMap.get(fileId) || (index != null ? index + 1 : label)`，但這是 UI 微調，可後續決定。

### 證物清單 Tab

位置：`src/client/components/analysis/ExhibitsTab.tsx`

放在右側 analysis panel 中（與 Disputes、Damages 同級）。

結構：
```
┌─ 證物清單 ─────────────────────────────────────────┐
│                                                      │
│  甲方證物                                [+ 新增]   │
│  ┌──────┬───────────────┬──────┬────────┐           │
│  │ 編號  │ 名稱          │ 類型 │ 備註    │           │
│  ├──────┼───────────────┼──────┼────────┤           │
│  │ ≡ 1  │ 起訴書         │ 影本 │ ...    │     🗑   │
│  │ ≡ 2  │ 診斷證明書     │ 影本 │ ...    │     🗑   │
│  └──────┴───────────────┴──────┴────────┘           │
│                                                      │
│  乙方證物                                [+ 新增]   │
│  ┌──────┬───────────────┬──────┬────────┐           │
│  │ ≡ 1  │ 答辯狀         │ 繕本 │ ...    │     🗑   │
│  └──────┴───────────────┴──────┴────────┘           │
│                                                      │
│  [匯出證物清單]                                      │
└──────────────────────────────────────────────────────┘
```

功能：
- 按 prefix 分組（甲證、乙證各一區）
- 拖放排序 → reorder API → 重新編號
- 行內編輯 doc_type（select: 影本/正本/繕本）、description
- 刪除 → 同 prefix 重新編號
- 新增 → file picker（列出未編號的 files，含 court/other）
- 匯出 → 純文字表格（編號、名稱、類型、日期、備註）

### State 管理

在 `useBriefStore` 新增：

```typescript
// State
exhibits: Exhibit[];

// Actions
setExhibits: (exhibits: Exhibit[]) => void;
loadExhibits: (caseId: string) => Promise<void>;
addExhibit: (caseId: string, fileId: string, prefix?: string) => Promise<void>;
updateExhibit: (caseId: string, exhibitId: string, patch: Partial<Exhibit>) => Promise<void>;
reorderExhibits: (caseId: string, prefix: string, order: string[]) => Promise<void>;
removeExhibit: (caseId: string, exhibitId: string) => Promise<void>;

// Computed
exhibitMap: () => Map<string, string>;  // file_id → label
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| 證物編號層級 | case-level | 符合台灣法院實務，跨書狀延續 |
| Citation label 策略 | Render-time mapping（不改 content_structured） | 零 sync 風險，exhibit 操作只改 exhibits 表 |
| 編號格式 | 阿拉伯數字（甲證1） | 多數法院慣例 |
| 自動分配策略 | 按書狀引用首次出現順序，已有編號不動 | 跨書狀延續 |
| court/other 檔案 | 預設不編號，可手動加入 | 法院文書通常不列入證物清單 |
| 備註預設值 | doc_type='影本', description=summary 第一句 | 覆蓋最常見情況 |
| label 欄位 | 不存，從 prefix+number 計算 | 減少 sync 負擔 |
| sort_order 欄位 | 不存，用 number 排序 | prefix 分組內 number 即順序 |
