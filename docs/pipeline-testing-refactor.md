# Pipeline 測試化重構方案

> 目標：讓 pipeline 各步驟可獨立執行、replay、A/B 測試，不改變現有流程邏輯。

---

## 現狀問題

| 問題                         | 說明                                                                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **測試程式碼複製正式程式碼** | `ab-test.mjs` 複製了 `PCODE_MAP`、`ALIAS_MAP`、`CLAIMS_RULES`、`SECTION_RULES`、`JSON_SCHEMA`；`search-test.mjs` 複製了 `PCODE_MAP`、`ALIAS_MAP`、`CONCEPT_TO_LAW`。**所有現有測試腳本 0 import from `src/server/`**，全部自己複製一份 |
| **已發生的 divergence**      | `JSON_OUTPUT_MAX_TOKENS` 正式程式碼已改為 32768，`ab-test.mjs` 仍為 16384。prompt 修改後測試也不會跟上                                                                                                                                 |
| 無法單獨跑某個 step          | Step 3 Writer 需要 Step 0-2 的所有累積狀態，測一次要等完整 pipeline（2-10 分鐘）                                                                                                                                                       |
| ContextStore 無 serialize    | 步驟間透過 mutable object 溝通，無法存檔/還原                                                                                                                                                                                          |
| 測試覆蓋率低                 | 只有 `resolveLawsForSection` 有 unit test；enrichment、validation、prompt building 零覆蓋                                                                                                                                              |
| A/B 測試成本高               | 換 model/prompt 要跑完整 pipeline，無法只重跑變更的 step                                                                                                                                                                               |
| 品質指標手動收集             | `pipeline-benchmark.mjs` 要開 dev server + 打 SSE，無法離線分析                                                                                                                                                                        |

### 已確認的 divergence 清單

| 常數/邏輯                | 正式程式碼位置                         | 測試腳本位置                                 | 狀態                |
| ------------------------ | -------------------------------------- | -------------------------------------------- | ------------------- |
| `JSON_OUTPUT_MAX_TOKENS` | `reasoningStrategyStep.ts` → **32768** | `ab-test.mjs` → **16384**                    | 已不同步            |
| `PCODE_MAP` (78 部法規)  | `lawConstants.ts`                      | `ab-test.mjs` + `search-test.mjs` (各自複製) | 新增法規需手動同步  |
| `ALIAS_MAP`              | `lawConstants.ts`                      | `ab-test.mjs` + `search-test.mjs`            | 同上                |
| `CONCEPT_TO_LAW`         | `lawConstants.ts`                      | `search-test.mjs`                            | 同上                |
| `CLAIMS_RULES`           | `strategyConstants.ts`                 | `ab-test.mjs`                                | prompt 改了測試不跟 |
| `SECTION_RULES`          | `strategyConstants.ts`                 | `ab-test.mjs`                                | 同上                |
| `STRATEGY_JSON_SCHEMA`   | `strategyConstants.ts`                 | `ab-test.mjs`                                | 同上                |

---

## 設計原則

1. **測試程式碼 import 正式程式碼** — 絕不複製常數/邏輯到測試腳本，統一 source of truth
2. **不改現有流程邏輯** — pipeline 主流程、ContextStore 結構、step 呼叫簽名全部不動
3. **不加 adapter 抽象層** — 不為 D1/Claude/MongoDB 建 interface，避免維護成本翻倍
4. **Snapshot 全部存 JSON 檔案** — 不進 D1，不新增 table
5. **增量改動** — 每個階段獨立可交付，不需要全部完成才能使用
6. **用 `tsx` 跑 TypeScript 測試腳本** — 測試腳本從 `.mjs` 改為 `.ts`，直接 import `src/server/` 模組
7. **Import 隔離** — 測試腳本只 import 純邏輯模組（constants、validation、types），不 import 含 Workers/AI/DB 依賴的模組。需要被 import 的常數應放在不會拉進 Workers-specific dependency 的獨立檔案中
8. **`src/server/` 不碰 `fs`** — snapshot 寫檔邏輯用 callback 注入，不在 server code 引入 Node.js `fs` module（Workers 環境不支援）

---

## 架構概覽

```
正常 pipeline 執行（不變）
─────────────────────────────────────────────────────────
  Step 0 ──→ Step 1 ──→ Step 2 ──→ Step 3
    │           │           │           │
    ▼           ▼           ▼           ▼
  callback    callback    callback    callback   ← 新增（optional）
    │           │           │           │
    ▼           ▼           ▼           ▼
  snapshots/{caseId}-{timestamp}/
    step0.json  step1.json  step2.json  step3.json
    quality-report.json

Replay 模式（新增）
─────────────────────────────────────────────────────────
  讀取 step2.json ──→ 還原 ContextStore ──→ 跑 Step 3 ──→ 比較 output
  讀取 step1.json ──→ 還原 ContextStore ──→ 跑 Step 2 ──→ 比較 strategy
```

---

## 階段零：測試腳本改為 import from source（最高優先）

> **這是整個重構方案的基礎** — 不做這步，後續階段的 replay 腳本一樣會 diverge。

### 問題根因

現有測試腳本都是 `.mjs`，無法 import TypeScript source。所以每個腳本都複製了一份常數和邏輯。

### 解法

1. 安裝 `tsx` 作為 devDependency（輕量 TypeScript runner，不需設定 tsconfig）
2. 把現有測試腳本從 `.mjs` 改為 `.ts`
3. 刪除複製的常數，改為 import from source

### ⚠️ 前置驗證：import chain 乾淨度檢查

在開始遷移腳本之前，**必須先驗證**目標模組的 import chain 不會拉進 Workers 依賴。type import 也會觸發 tsx 的模組解析（例如 `import type { X } from './types'`，如果 `types.ts` transitively import 了 D1/R2 等 Workers API，就會爆掉）。

**驗證方式**：

```bash
# 逐一測試每個要被 import 的模組
npx tsx --eval "import './src/server/agent/pipeline/strategyConstants.ts'"
npx tsx --eval "import './src/server/lib/lawConstants.ts'"
npx tsx --eval "import './src/server/agent/contextStore.ts'"
```

如果爆了，根據錯誤訊息判斷：

- **type import 拉進 Workers 依賴**：把純 type 定義拆到 `pipeline/types-pure.ts`（只包含不引用 Workers API 的型別），讓 constants 和 test 都從這裡 import
- **模組 top-level side effect**：該模組有 top-level 程式碼執行到 Workers API → 需要把被 import 的部分搬出來

這一步如果有問題，會直接影響後續所有階段，所以必須在遷移任何腳本之前完成。

### 改動範圍

**安裝**：

```bash
npm install -D tsx
```

**遷移腳本**（依優先順序）：

| 腳本                             | 改動                                                                                                                                                                                    | 刪除的複製程式碼 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `search-test.mjs` → `.ts`        | import `PCODE_MAP`, `ALIAS_MAP`, `CONCEPT_TO_LAW` from `lawConstants.ts`                                                                                                                | ~100 行          |
| `ab-test.mjs` → `.ts`            | import `CLAIMS_RULES`, `SECTION_RULES`, `JSON_SCHEMA` from `strategyConstants.ts`；import `PCODE_MAP`, `ALIAS_MAP` from `lawConstants.ts`；import constants from `strategyConstants.ts` | ~200 行          |
| `phase2-ab-test.mjs` → `.ts`     | 同 ab-test                                                                                                                                                                              | ~150 行          |
| `strategy-compare.mjs` → `.ts`   | import search 相關常數                                                                                                                                                                  | ~50 行           |
| `test-law-fallback.mjs` → `.ts`  | import `ContextStore` + types                                                                                                                                                           | ~30 行           |
| `pipeline-benchmark.mjs` → `.ts` | import `QualityReport` type（階段一完成後）                                                                                                                                             | 少量             |

**package.json scripts 更新**：

```json
{
  "scripts": {
    "test:law-search": "tsx scripts/law-search-test/search-test.ts",
    "test:law-fallback": "tsx scripts/pipeline-test/test-law-fallback.ts",
    "test:ab": "tsx scripts/reasoning-ab-test/ab-test.ts",
    "test:benchmark": "tsx scripts/pipeline-test/pipeline-benchmark.ts"
  }
}
```

### 需要 export 的函式/常數

目前部分函式是 module-private，需改為 export：

| 模組                   | 需 export                                               | 目前狀態  |
| ---------------------- | ------------------------------------------------------- | --------- |
| `lawConstants.ts`      | `PCODE_MAP`, `ALIAS_MAP`, `CONCEPT_TO_LAW`              | 已 export |
| `strategyConstants.ts` | `CLAIMS_RULES`, `SECTION_RULES`, `STRATEGY_JSON_SCHEMA` | 需確認    |
| `contextStore.ts`      | `ContextStore` class                                    | 已 export |

### 常數搬遷：避免 import chain 拉進 Workers 依賴

`reasoningStrategyStep.ts` 的 `MAX_ROUNDS`、`MAX_SEARCHES`、`JSON_OUTPUT_MAX_TOKENS` 需要被測試腳本 import，但該模組 import 了 `aiClient.ts`（Cloudflare AI Gateway）、`claudeClient.ts` 等 Workers-specific 模組。

**解法**：把這些常數搬到 `strategyConstants.ts`（純常數檔，無 Workers 依賴）：

```typescript
// strategyConstants.ts（新增）
export const MAX_ROUNDS = 6;
export const MAX_SEARCHES = 10;
export const JSON_OUTPUT_MAX_TOKENS = 32768;
```

`reasoningStrategyStep.ts` 改為 import from `strategyConstants.ts`。這樣測試腳本只需 import `strategyConstants.ts`，不會間接拉進 AI client。

**原則**：任何被測試腳本 import 的常數/type，都應放在不 import Workers API 的純邏輯模組中。

### 不動什麼

- 不改任何函式邏輯
- 不改正式 pipeline 程式碼（除了搬移常數到純邏輯模組）
- 只改 export visibility + 測試腳本的 import 來源

### Workers 環境差異處理

測試腳本 import `src/server/` 模組時，可能遇到 Workers-specific API（如 D1 binding）。處理方式：

- **純邏輯函式**（lawConstants、strategyConstants、validateStrategy）：直接 import，無環境依賴
- **含 DB 操作的函式**（writeSection、briefPipeline）：在後續階段的 replay 腳本中用 stub `PipelineContext` 處理
- **含 AI client 的模組**：不 import 該模組，所需常數已搬到純邏輯模組

---

## 階段一：Quality Report 自動化

> 提前到階段一（原階段二），因為不依賴 serialize，且能立即統一 `pipeline-benchmark` 裡重複的 `analyzeBrief` 邏輯。先做這步可以讓後續所有 snapshot 都自帶品質報告。

### buildQualityReport 函式

```typescript
// src/server/agent/pipeline/qualityReport.ts

export interface QualityReport {
  timestamp: string;
  totalParagraphs: number;
  totalLawCites: number;
  totalFileCites: number;
  totalCites: number;
  totalChars: number;
  zeroLawContentSections: number;
  contentSectionCount: number;
  zeroCiteAllSections: number;
  perSection: Array<{
    section: string;
    subsection?: string;
    disputeId?: string;
    lawCites: number;
    fileCites: number;
    charCount: number;
    lawIds: string[];
  }>;
}

export const buildQualityReport = (paragraphs: Paragraph[], store: ContextStore): QualityReport => {
  // ...從 paragraphs 的 citations 統計，邏輯同 pipeline-benchmark.mjs 的 analyzeBrief
};
```

### 用途

1. **每次 pipeline 執行**自動產生（存在 step3.json 裡）
2. **離線比較**不需要查 D1，直接比較 JSON
3. **取代 pipeline-benchmark 的 analyzeBrief 函式**（同一套邏輯，由階段零的 import 機制統一）

### 影響範圍

- 新增：`pipeline/qualityReport.ts`（~60 行）
- 修改：`briefPipeline.ts`（step3 完成後呼叫 buildQualityReport，經 callback 輸出）
- 修改：`pipeline-benchmark.ts`（改為 import `buildQualityReport`，刪除自己的 `analyzeBrief`）

---

## 階段二：ContextStore serialize/deserialize

### 改什麼

在 `src/server/agent/contextStore.ts` 新增兩個方法：

```typescript
/** 序列化所有狀態為 JSON-safe 物件 */
serialize = (): ContextStoreSnapshot => ({
  _version: 1,
  caseSummary: this.caseSummary,
  parties: this.parties,
  caseMetadata: this.caseMetadata,
  timelineSummary: this.timelineSummary,
  briefType: this.briefType,
  legalIssues: this.legalIssues,
  informationGaps: this.informationGaps,
  damages: this.damages,
  timeline: this.timeline,
  claims: this.claims,
  sections: this.sections,
  reasoningSummary: this.reasoningSummary,
  perIssueAnalysis: this.perIssueAnalysis,
  supplementedLaws: this.supplementedLaws,
  foundLaws: this.foundLaws,
  draftSections: this.draftSections,
});

/** 從 snapshot 還原狀態（明確賦值，避免 Object.assign 遺漏新欄位） */
static fromSnapshot = (snap: ContextStoreSnapshot): ContextStore => {
  const store = new ContextStore();
  store.caseSummary = snap.caseSummary;
  store.parties = snap.parties;
  store.caseMetadata = snap.caseMetadata;
  store.timelineSummary = snap.timelineSummary;
  store.briefType = snap.briefType;
  store.legalIssues = snap.legalIssues ?? [];
  store.informationGaps = snap.informationGaps ?? [];
  store.damages = snap.damages ?? [];
  store.timeline = snap.timeline ?? [];
  store.claims = snap.claims ?? [];
  store.sections = snap.sections ?? [];
  store.reasoningSummary = snap.reasoningSummary ?? '';
  store.perIssueAnalysis = snap.perIssueAnalysis ?? [];
  store.supplementedLaws = snap.supplementedLaws ?? [];
  store.foundLaws = snap.foundLaws ?? [];
  store.draftSections = snap.draftSections ?? [];
  return store;
};
```

### Type 定義

```typescript
export interface ContextStoreSnapshot {
  _version: 1; // schema version，方便未來 migration
  caseSummary: string;
  parties: { plaintiff: string; defendant: string };
  caseMetadata: CaseMetadata;
  timelineSummary: string;
  briefType: string;
  legalIssues: LegalIssue[];
  informationGaps: InformationGap[];
  damages: DamageItem[];
  timeline: TimelineItem[];
  claims: Claim[];
  sections: StrategySection[];
  reasoningSummary: string;
  perIssueAnalysis: PerIssueAnalysis[];
  supplementedLaws: FetchedLaw[];
  foundLaws: FoundLaw[];
  draftSections: DraftSection[];
}
```

### 為什麼不用 Object.assign

ContextStore 的陣列欄位初始值為 `[]`。如果未來新增欄位但舊 snapshot 裡沒有，`Object.assign` 會把 `undefined` 覆蓋到 `[]` 上，導致 `for...of` 等操作直接炸掉。明確賦值 + `?? []` 確保向前相容。

`_version` 欄位讓未來 schema 變動時可以寫 migration 邏輯（例如 `if (snap._version === 1) { ... }`），不需要棄用舊 snapshot。

### 不動什麼

- ContextStore 的所有現有 method 簽名不變
- 外部呼叫者完全不受影響

### 影響範圍

- 修改：`contextStore.ts`（新增 ~50 行）
- 新增：`ContextStoreSnapshot` type（在同檔或 `pipeline/types.ts`）

---

## 階段三：Pipeline Snapshot 存檔（Callback 注入模式）

### 設計決策：為什麼用 callback 而不是 `writeFileSync`

原方案在 `src/server/agent/pipeline/snapshotUtils.ts` 用 `import { writeFileSync } from 'fs'`。問題：

1. **Workers 環境沒有 `fs`** — 這個檔案在 `src/server/` 裡，會被 Cloudflare Workers build 時 bundle 進去
2. **違反設計原則** — server code 不應有 Node.js-only 的依賴

**解法**：pipeline 接受 optional callback，由呼叫端決定如何處理 snapshot（寫檔、存 memory、或忽略）。

### 改什麼

`briefPipeline.ts` 的 `runBriefPipeline` 接受 optional `onStepComplete` callback：

```typescript
export interface PipelineOptions {
  /** 每個 step 完成時呼叫，由外部決定如何存檔（支援 async，例如存到 R2） */
  onStepComplete?: (stepName: string, data: unknown) => void | Promise<void>;
}

export const runBriefPipeline = async (
  ctx: PipelineContext,
  opts?: PipelineOptions,
): Promise<ToolResult> => {
  // ...existing code...
};
```

每個 step 完成後呼叫 callback：

```typescript
// Step 0 完成後
const step0 = await runCaseAnalysis(ctx, store, { ... });
await opts?.onStepComplete?.('step0', {
  store: store.serialize(),
  briefId: step0.briefId,
  parsedFiles: step0.parsedFiles,
  fileContentMap: mapToJson(step0.fileContentMap),
  allLawRefRows: step0.allLawRefRows,
  templateContentMd: step0.templateContentMd,
});

// Step 1 完成後
await opts?.onStepComplete?.('step1', {
  store: store.serialize(),
  fetchedLawsArray,
  userAddedLaws,
});

// Step 2 完成後（最重要 — replay Step 3 的起點）
await opts?.onStepComplete?.('step2', {
  store: store.serialize(),
  briefId: step0.briefId,
  fileContentMap: mapToJson(step0.fileContentMap),
  strategyInput,
  strategyOutput,
  // AI 呼叫記錄（debug + prompt tuning 用）
  aiTrace: {
    reasoningConversation,     // Phase A 的完整 tool-loop 對話
    structuringPrompt,         // Phase B 給 Gemini 的 buildJsonOutputMessage() 輸出
    structuringRawOutput,      // Phase B Gemini 回傳的原始 JSON
    enrichmentLog,             // enrichment 每步的修改記錄
  },
});

// Step 3 完成後
await opts?.onStepComplete?.('step3', {
  store: store.serialize(),
  paragraphs,
  qualityReport: buildQualityReport(paragraphs, store),
  // 每個 section 的 Writer 呼叫記錄
  aiTrace: {
    perSectionCalls: sectionCallLogs,  // [{instruction, response, usage}]
  },
});
```

### Snapshot 寫檔工具（放在 `scripts/`，不在 `src/server/`）

```typescript
// scripts/pipeline-test/snapshot-writer.ts
import { writeFileSync, mkdirSync } from 'fs';

/** 建立一個寫檔 callback，供 PipelineOptions.onStepComplete 使用 */
export const createSnapshotWriter = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  return (stepName: string, data: unknown) => {
    writeFileSync(`${dir}/${stepName}.json`, JSON.stringify(data, null, 2));
  };
};
```

### Map 序列化工具（放在 `src/server/`，無 fs 依賴）

```typescript
// src/server/agent/pipeline/snapshotUtils.ts（只有純函式，無 fs）

/** Map → JSON-safe array (Map 不能直接 JSON.stringify) */
export const mapToJson = <K, V>(map: Map<K, V>): [K, V][] => [...map.entries()];

/** JSON array → Map */
export const jsonToMap = <K, V>(entries: [K, V][]): Map<K, V> => new Map(entries);
```

### AI 呼叫記錄（aiTrace）

每個 step 的 snapshot 額外記錄該步驟的 AI 呼叫 input/output，用於：

1. **Debug** — 看 Gemini/Claude 到底收到什麼 prompt 才產出某個結果
2. **Prompt tuning** — 不需重跑就能分析 prompt 效果
3. **成本追蹤** — 每次呼叫的 token usage

**Step 2 aiTrace**：

- `reasoningConversation`：Phase A 的完整 tool-loop 對話（含 search_law 呼叫和結果）
- `structuringPrompt`：Phase B `buildJsonOutputMessage()` 的回傳值
- `structuringRawOutput`：Gemini 回傳的原始 JSON（enrichment 之前）
- `enrichmentLog`：enrichment 每步的修改記錄（已有 logging，直接存下來）

**Step 3 aiTrace**：

- `perSectionCalls[]`：每個 section 的 `{instruction, response, usage}`

`aiTrace` 是 optional 欄位，不影響 replay（replay 不需要讀取舊的 AI 記錄，只需要 store + input data）。

### fileContentMap 分離存放

`fileContentMap`（完整檔案內容）在多檔案案件中可能到 MB 級別。為避免單一 JSON 過大：

- `step0.json` 和 `step2.json` 的 `fileContentMap` 改為存在獨立檔案 `step0-files.json`
- 主 JSON 裡存 `fileContentMapRef: 'step0-files.json'`
- replay 腳本讀取時自動解析 ref，按需載入

```typescript
// snapshot-writer.ts 處理分離邏輯
const writeStepData = (dir: string, stepName: string, data: Record<string, unknown>) => {
  if (data.fileContentMap) {
    writeFileSync(`${dir}/${stepName}-files.json`, JSON.stringify(data.fileContentMap));
    data = { ...data, fileContentMap: undefined, fileContentMapRef: `${stepName}-files.json` };
  }
  writeFileSync(`${dir}/${stepName}.json`, JSON.stringify(data, null, 2));
};
```

### Snapshot JSON 結構

```
snapshots/
  z4keVNf-20260303-143022/
    step0.json         ~30KB  (store + briefId + parsedFiles + fileContentMapRef)
    step0-files.json   ~50KB+ (fileContentMap，獨立存放)
    step1.json         ~80KB  (store + fetchedLaws)
    step2.json         ~120KB (store + strategyInput + strategyOutput + aiTrace + fileContentMapRef)
    step3.json         ~200KB (store + paragraphs + qualityReport + aiTrace)
```

### 不動什麼

- `onStepComplete` 不傳時，pipeline 行為 100% 不變
- 不改任何 step 的內部邏輯
- 不改 PipelineContext interface（opts 是分開的參數）
- `src/server/` 裡沒有任何 `fs` import

### 影響範圍

- 修改：`briefPipeline.ts`（新增 ~20 行 callback 呼叫）
- 新增：`pipeline/snapshotUtils.ts`（~10 行，純 Map 工具）
- 新增：`scripts/pipeline-test/snapshot-writer.ts`（~15 行，寫檔 callback）

---

## 階段四：Step Replay 測試腳本

### 核心腳本

所有腳本都是 `.ts`，用 `tsx` 執行，直接 import server 程式碼：

```
scripts/pipeline-test/
  run-with-snapshots.ts     # 跑完整 pipeline + 存 snapshot
  replay-step3.ts           # 從 step2.json 還原 → 跑 Step 3 → 輸出品質報告
  replay-step2.ts           # 從 step1.json 還原 → 跑 Step 2 → 輸出策略報告
  compare-reports.ts        # 比較兩份 quality-report.json
```

> **replay-step2 和 replay-step3 優先級相同。** 從 benchmark history 看，Step 2（Reasoning + Structuring）的品質是最大瓶頸 — enrichment、法條搜尋、dispute_id mapping 的問題都在這一步。Step 2 的 prompt tuning 需求可能比 Step 3 更頻繁。

### replay-step3.ts 流程

```
1. 讀取 step2.json
2. ContextStore.fromSnapshot(data.store) 還原狀態
3. jsonToMap(data.fileContentMap) 還原 Map
4. 建立 Proxy-based noop D1 stub（見下方）
5. 用真實 Claude API 逐段呼叫 writeSection()
6. 輸出 quality report（import buildQualityReport）+ 比較 baseline
```

```bash
# 用法
npx tsx scripts/pipeline-test/replay-step3.ts \
  --snapshot snapshots/z4keVNf-20260303-143022/step2.json \
  --dry-run            # 跳過 D1 寫入
  --model claude-sonnet-4-6  # 可選：換模型

# 比較
npx tsx scripts/pipeline-test/compare-reports.ts \
  snapshots/z4keVNf-run1/step3.json \
  snapshots/z4keVNf-run2/step3.json
```

### replay-step2.ts 流程

Step 2 包含 Phase A（reasoning tool-loop）和 Phase B（structuring + enrichment），兩者的迭代需求不同。

**Phase A 需要真正的 MongoDB**（`search_law` tool call），noop proxy 會讓搜尋回傳空結果，reasoning 品質會完全不同。**Phase B 只需要 Phase A 的輸出**（`reasoningSummary` + `perIssueAnalysis`），不碰 MongoDB。

因此 replay-step2 支援兩種模式：

#### Full Replay（Phase A + B）

需要 MongoDB 連線，真正重跑 reasoning tool-loop。用來測 **prompt/model 變化**對整體策略品質的影響。

```
1. 讀取 step1.json
2. ContextStore.fromSnapshot(data.store) 還原狀態
3. 用真實 AI API + 真實 MongoDB 跑完整 runReasoningStrategy()
4. 輸出 strategyOutput（claims + sections）
5. 跑 enrichment + validation，輸出品質統計
```

```bash
npx tsx scripts/pipeline-test/replay-step2.ts \
  --snapshot snapshots/z4keVNf-20260303-143022/step1.json \
  --model claude-haiku-4-5-20251001  # 可選：換 reasoning model

# A/B 測試 Step 2 prompt
npx tsx scripts/pipeline-test/replay-step2.ts \
  --snapshot snapshots/z4keVNf-xxx/step1.json \
  --prompt-override ./my-new-prompt.txt
```

#### Cached Replay（僅 Phase B）— 更常用

從 step2.json 的 `aiTrace` 讀取 Phase A 已有的 `reasoningSummary` + `perIssueAnalysis`，只重跑 Phase B structuring + enrichment。**不需要 MongoDB**，速度快（~10s vs ~60s）。

用來測 **structuring prompt、JSON schema、enrichment 邏輯**的變化 — 這是最常需要迭代的部分。

```
1. 讀取 step2.json（注意：用的是 step2 不是 step1）
2. 還原 ContextStore，其中已包含 Phase A 的 reasoningSummary + perIssueAnalysis
3. 只跑 Phase B：buildJsonOutputMessage() → callGeminiNative() → enrichment → validation
4. 輸出 strategyOutput + 品質比較
```

```bash
npx tsx scripts/pipeline-test/replay-step2.ts \
  --snapshot snapshots/z4keVNf-xxx/step2.json \
  --phase-b-only                    # 只跑 structuring + enrichment
  --model gemini-2.5-flash          # 可選：換 structuring model
```

### Workers API stub 方案（Proxy 極簡版）

原方案需要 mock 整個 D1 interface，容易因 API 變動而壞掉。改用 Proxy 自動攔截所有呼叫：

```typescript
// scripts/pipeline-test/stub-context.ts
import type { PipelineContext } from '../../src/server/agent/pipeline/types';

/** 遞迴 Proxy — 任何 method call 都回傳空結果，不會炸 */
const createNoopProxy = (): unknown =>
  new Proxy(() => ({ results: [], success: true }), {
    get: (_target, prop) => {
      if (prop === 'then') return undefined; // 防止被當成 Promise
      return createNoopProxy();
    },
    apply: () => ({ results: [], success: true }),
  });

export const createStubContext = (overrides?: Partial<PipelineContext>): PipelineContext =>
  ({
    env: {
      DB: createNoopProxy() as D1Database,
      BUCKET: createNoopProxy() as R2Bucket,
      // ...其他 env vars 從 .dev.vars 讀取
    },
    caseId: 'replay-stub',
    ...overrides,
  }) as PipelineContext;
```

**好處**：不需要模擬完整 D1/R2 interface，Proxy 會自動攔截任何 chain（如 `env.DB.prepare().bind().run()`）。即使 D1 API 新增方法也不會壞。

### --dry-run 模式

Step 3 replay 時，D1 相關操作（`UPDATE briefs`、`INSERT brief_versions`、`cleanupUncitedLaws`）全部由 noop Proxy 攔截。只關心 Writer 產出的 paragraphs 品質。

### 影響範圍

- 新增：4 個 `.ts` 腳本（各 ~100-150 行）+ `stub-context.ts`（~30 行）
- 修改：無（腳本 import server 程式碼，不改 server 程式碼）

---

## 階段五：純函式 Unit Test 擴充

### 可 unit test 的純函式（不需要 AI/DB）

| 函式                                      | 檔案                             | 測什麼                                                |
| ----------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| `enrichStrategyOutput`                    | `reasoningStrategyStep.ts`       | dispute_id fuzzy match、law_ids 填補、subsection 推導 |
| `validateStrategyOutput`                  | `validateStrategy.ts`            | 10 項結構檢查                                         |
| `buildJsonOutputMessage`                  | `reasoningStrategyStep.ts`       | prompt 組裝正確性                                     |
| `resolveLawsForSection`                   | `contextStore.ts`                | 3-tier fallback（已有）                               |
| `stripLeadingHeadings`                    | `writerStep.ts`                  | heading 去重                                          |
| `rebuildSegmentsAfterStrip`               | `writerStep.ts`                  | segment offset 對齊                                   |
| `parseLawRef`                             | `lawFetchStep.ts`                | 法條字串解析                                          |
| `expandWithCompanions`                    | `lawFetchStep.ts`                | 關聯法條帶出                                          |
| `truncateLawContent`                      | `lawFetchStep.ts`                | 截斷邏輯                                              |
| `buildQualityReport`                      | `qualityReport.ts`（階段一新增） | 品質統計                                              |
| `ContextStore.serialize` / `fromSnapshot` | `contextStore.ts`（階段二新增）  | round-trip 正確性                                     |

### 測試結構

所有測試改為 `.ts`，import from source：

```
scripts/pipeline-test/
  test-law-fallback.ts          # 已有（從 .mjs 遷移）
  test-enrichment.ts            # 新增
  test-validation.ts            # 新增
  test-snapshot-roundtrip.ts    # 新增
  run-all-unit-tests.ts         # 新增：跑全部 unit test
```

### 優先順序

1. `test-snapshot-roundtrip.ts` — 確保 serialize/deserialize 不丟資料
2. `test-enrichment.ts` — enrichment 是品質關鍵，需要防護
3. `test-validation.ts` — 確保 validation 不漏判

### 函式搬遷：避免 import 含 Workers 依賴的模組

部分要 unit test 的純函式（如 `enrichStrategyOutput`、`buildJsonOutputMessage`）目前在 `reasoningStrategyStep.ts` 裡，而該模組 import 了 `aiClient.ts`、`claudeClient.ts`。即使只 export 純函式，tsx 載入模組時也會解析整個 import tree。

**解法**：把純函式搬到獨立模組：

| 函式                                                        | 目前位置                   | 搬到                               |
| ----------------------------------------------------------- | -------------------------- | ---------------------------------- |
| `enrichStrategyOutput`                                      | `reasoningStrategyStep.ts` | `strategyEnrichment.ts`（新增）    |
| `buildJsonOutputMessage`                                    | `reasoningStrategyStep.ts` | `strategyPromptBuilder.ts`（新增） |
| `stripLeadingHeadings`, `rebuildSegmentsAfterStrip`         | `writerStep.ts`            | `writerUtils.ts`（新增）           |
| `parseLawRef`, `expandWithCompanions`, `truncateLawContent` | `lawFetchStep.ts`          | `lawFetchUtils.ts`（新增）         |

原模組改為 import from 新模組，不影響外部行為。這和階段零的常數搬遷是同一個模式。

### 影響範圍

- 需要把部分函式 export（目前有些是 module-private）
- 需要把含 Workers 依賴模組中的純函式搬到獨立檔案
- 不改函式邏輯，只改 export visibility 和檔案位置

---

## 階段六（可選）：run-with-snapshots 整合到 benchmark

### 改造 pipeline-benchmark

現有 `pipeline-benchmark` 打 HTTP SSE → 查 D1 統計。改造後：

```bash
# 方案 A：加 --save-snapshots flag，pipeline 自動存 snapshot（短期，修改最小）
npx tsx scripts/pipeline-test/pipeline-benchmark.ts --runs 3 --save-snapshots

# 方案 B：新腳本直接 import pipeline（不經 HTTP），更乾淨（中期）
npx tsx scripts/pipeline-test/run-with-snapshots.ts --case-id z4keVNf
```

方案 B 較好 — 不依賴 dev server，直接在 Node.js 跑 pipeline。但需要解決 Workers 環境差異（D1 binding 等），可借用階段四的 stub PipelineContext。

短期建議用方案 A（修改最小），中期再考慮方案 B。

---

## 實作順序與優先級

| 順序  | 階段                                              | 改動量                            | 依賴                           | 效果                                                 |
| ----- | ------------------------------------------------- | --------------------------------- | ------------------------------ | ---------------------------------------------------- |
| **0** | **階段零：測試腳本 import from source**           | **~50 行改動 + 刪除 ~500 行複製** | 無（含前置 import chain 驗證） | **立即解決同步問題**                                 |
| 1     | 階段一：serialize/deserialize                     | ~50 行                            | 無                             | 為 snapshot 做準備，是階段三+四的前置條件            |
| 2     | 階段二：quality report                            | ~60 行                            | 無                             | 統一品質分析邏輯，立即可被 benchmark 使用            |
| 3     | 階段三：snapshot 存檔（callback 注入）            | ~60 行                            | 階段一+二                      | 每次跑 pipeline 自動存 fixture + 品質報告 + AI trace |
| 4     | 階段四：replay 腳本（**step2 + step3 並行開發**） | ~500 行                           | 階段零+一+二+三                | **核心目標：單獨跑 Step 2 或 Step 3**                |
| 5     | 階段五：unit test 擴充                            | ~400 行                           | 階段零 + 函式搬遷              | 防護 enrichment/validation                           |
| 6     | 階段六：benchmark 整合                            | ~100 行                           | 階段四                         | 完整 CI 流程                                         |

### 為什麼 Serialize 在 Quality Report 之前

Serialize 是階段三（snapshot 存檔）和階段四（replay）的前置條件 — 沒有 `serialize()` / `fromSnapshot()` 就無法存/還原 ContextStore。先確保 round-trip 正確，後續階段會更順。Quality Report 雖然不依賴 serialize，但也不被任何階段 block，順序對調不影響整體。

### 為什麼 Step 2 Replay 和 Step 3 並行

從 benchmark history 看，Step 2 的品質問題（enrichment 失準、法條搜不到、dispute_id 錯配）是最頻繁的瓶頸。只做 Step 3 replay 無法迭代 Step 2 的 prompt/model 選擇。兩個 replay 腳本結構相似，可以並行開發。

### 最小可用版本（階段 0 + 1-4）

階段零可以獨立做完，立即獲得價值。加上階段 1-4 就達成核心目標：

```bash
# 階段零完成後：所有測試腳本都 import from source，不再 diverge
npx tsx scripts/law-search-test/search-test.ts
npx tsx scripts/reasoning-ab-test/ab-test.ts

# 階段 1-4 完成後：可以單獨 replay 某個 step
npx tsx scripts/pipeline-test/replay-step3.ts --snapshot snapshots/z4keVNf-xxx/step2.json
npx tsx scripts/pipeline-test/replay-step2.ts --snapshot snapshots/z4keVNf-xxx/step1.json

# 比較品質
npx tsx scripts/pipeline-test/compare-reports.ts old.json new.json
```

---

## 風險評估

| 風險                                                            | 程度              | 緩解                                                                                     |
| --------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| tsx import Workers code 失敗（import chain 拉進 AI Gateway/D1） | **中高**          | 階段零前置驗證（`npx tsx --eval`）；常數搬到純邏輯模組；階段五純函式搬到獨立模組         |
| type import 間接拉進 Workers 依賴                               | **中**            | 前置驗證會抓到；必要時拆出 `types-pure.ts`                                               |
| Step 2 full replay 需要 MongoDB                                 | **中**            | 提供 cached replay 模式（`--phase-b-only`），只跑 structuring + enrichment，不碰 MongoDB |
| replay 腳本需要 AI API credentials                              | **中**            | replay 腳本從 `.dev.vars` 讀取 env（AI Gateway URL、Anthropic key），需在文件中明確說明  |
| serialize 漏掉欄位                                              | 低                | `fromSnapshot` 明確賦值 + `?? []` 防護 + round-trip unit test                            |
| 舊 snapshot 缺少新欄位                                          | 低                | `_version` 欄位 + `?? []` fallback，向前相容                                             |
| snapshot 檔案太大（多檔案案件 fileContentMap 到 MB 級）         | 低                | fileContentMap 分離存放為獨立 JSON 檔，replay 按需載入                                   |
| replay 時 D1 不一致                                             | 低                | Proxy-based noop stub 自動攔截所有 D1 操作                                               |
| `src/server/` 引入 `fs` 導致 Workers build 失敗                 | ~~中~~ **已消除** | callback 注入模式，`fs` 只在 `scripts/` 裡                                               |
| 現有流程被影響                                                  | 極低              | callback 不傳就完全不動                                                                  |

## 不做的事

- 不建 DB/AI adapter interface
- 不改 ContextStore 為 immutable
- 不改 step 的呼叫簽名
- 不改 PipelineContext interface
- 不動 SSE 機制
- 不建完整 test framework（vitest/jest），繼續用 `tsx` + plain Node.js assert 模式
- 不在測試腳本中複製任何正式程式碼的常數或邏輯
- 不在 `src/server/` 中 import Node.js `fs` module
