# Pipeline Test Suite

書狀品質測試工具，用於驗證 brief pipeline 的 citation 品質和穩定性。

所有腳本為 `.ts`，用 `npx tsx` 執行，直接 import `src/server/` 模組確保與正式程式碼同步。

## 測試腳本

### Unit Tests（純邏輯，不需外部服務）

| 腳本                         | 測試內容                                             |
| ---------------------------- | ---------------------------------------------------- |
| `test-law-fallback.ts`       | `resolveLawsForSection` 的 3-tier law fallback       |
| `test-enrichment.ts`         | `enrichStrategyOutput` 的 7 項 enrichment/validation |
| `test-validation.ts`         | `validateStrategyOutput` 的結構檢查                  |
| `test-snapshot-roundtrip.ts` | ContextStore serialize/deserialize round-trip        |
| `test-context-store.ts`      | ContextStore 其他方法                                |
| `test-truncation.ts`         | 截斷邏輯                                             |
| `test-stub-context.ts`       | Proxy-based noop stub                                |
| `test-compare-reports.ts`    | 品質報告比較邏輯                                     |
| `test-snapshot-writer.ts`    | Snapshot 寫檔邏輯                                    |

```bash
# 跑單一測試
npx tsx scripts/pipeline-test/test-law-fallback.ts
npx tsx scripts/pipeline-test/test-enrichment.ts

# 跑全部 unit tests
npx tsx scripts/pipeline-test/test-*.ts
```

### Replay 腳本（需要 AI API）

| 腳本                 | 用途                                                    |
| -------------------- | ------------------------------------------------------- |
| `replay-step2.ts`    | 從 snapshot 還原 → 重跑 Step 2（支援 `--phase-b-only`） |
| `replay-step3.ts`    | 從 snapshot 還原 → 重跑 Step 3 Writer                   |
| `compare-reports.ts` | 比較兩份 quality report                                 |

```bash
# Replay Step 3（需要 Anthropic API）
npx tsx scripts/pipeline-test/replay-step3.ts \
  --snapshot snapshots/z4keVNf-xxx/step2.json

# Replay Step 2 Phase B only（需要 Gemini API，不需 MongoDB）
npx tsx scripts/pipeline-test/replay-step2.ts \
  --snapshot snapshots/z4keVNf-xxx/step2.json \
  --phase-b-only

# 比較品質報告
npx tsx scripts/pipeline-test/compare-reports.ts old.json new.json
```

### Integration Benchmark（需要 dev server）

```bash
# 預設：跑 3 次，使用車禍測試案件
npx tsx scripts/pipeline-test/pipeline-benchmark.ts

# 自訂參數
npx tsx scripts/pipeline-test/pipeline-benchmark.ts --runs 5 --case-id YOUR_CASE_ID
```

**前提條件：**

- Dev server 正在運行（`npm run dev`）
- 本地 D1 有測試案件資料
- AUTH_TOKEN 從 `dist/lexdraft/.dev.vars` 自動讀取

### 工具模組

| 檔案                 | 用途                                     |
| -------------------- | ---------------------------------------- |
| `stub-context.ts`    | Proxy-based noop D1/R2 stub（replay 用） |
| `snapshot-writer.ts` | Snapshot 寫檔 callback（`fs` 操作）      |
| `_helpers.ts`        | 共用測試工具函式                         |

## 測試案件

**車禍損害賠償案**（`z4keVNfyuKvL68Xg1qPl2`）：

- 原告陳美玲騎機車遭被告王建宏左轉未讓直行車撞擊
- 2 個爭點：不能工作期間（8 週 vs 3 個月）、精神慰撫金是否適當
- 預期書狀結構：11-12 段落（header + 前言 + 6-7 內容 + 結論 + 證據方法 + footer）
- 涉及法條：民法 §18, §184, §191-2, §193, §195, §217

### Golden Fixtures

`snapshots/z4keVNfyuKvL68Xg1qPl2-golden/` 存放 4 份穩定版書狀（2026-03-14 產出）：

| 檔案           | Brief ID | Content Sections | Law | File | Total |
| -------------- | -------- | ---------------- | --- | ---- | ----- |
| `brief-1.json` | gQYQ35qK | 7                | 9   | 21   | 30    |
| `brief-2.json` | 0_pNtxlw | 6                | 9   | 19   | 28    |
| `brief-3.json` | modf_vKf | 6                | 11  | 21   | 32    |
| `brief-4.json` | bUYFMY-7 | 6                | 10  | 21   | 31    |

另含 `case.json`（案件 metadata）和 `disputes.json`（2 個爭點）。

Pipeline snapshots（step0~step3）需要時用 `generate-snapshots.ts` 重新產出。

## 何時該跑測試

- 修改 `contextStore.ts`（law/file context 分配邏輯）→ 跑 unit test
- 修改 `enrichStrategy.ts`（enrichment/validation 邏輯）→ 跑 `test-enrichment.ts`
- 修改 `validateStrategy.ts`（驗證邏輯）→ 跑 `test-validation.ts`
- 修改 `reasoningStrategyStep.ts`（Reasoning/Structuring 邏輯）→ 跑 replay-step2 或 benchmark
- 修改 `writerStep.ts`（Writer prompt 或 document 組裝）→ 跑 replay-step3 或 benchmark
- 修改 `strategyConstants.ts`（prompt/schema）→ 跑 benchmark

## 品質基線

最新基線（golden, 2026-03-14，4 份書狀平均）：

| Metric                 | 值        |
| ---------------------- | --------- |
| Law cites              | 9.8       |
| File cites             | 20.5      |
| Total cites            | 30.3      |
| 0-law content sections | **0/6~7** |

歷史版本對比見 MEMORY.md 的 Citation Benchmarks 表格。

## 結果檔案

- `benchmark-results.json` — 最新一次 benchmark 的完整結果（含 per-section 明細）
- 歷史結果可透過 git history 追溯
