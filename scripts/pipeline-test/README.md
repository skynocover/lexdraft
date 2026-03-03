# Pipeline Test Suite

書狀品質測試工具，用於驗證 brief pipeline 的 citation 品質和穩定性。

## 測試腳本

### 1. `test-law-fallback.mjs` — Unit Test (Law Fallback Logic)

測試 `contextStore.resolveLawsForSection` 的 3-tier law fallback 邏輯：

| Tier | 條件                    | 行為                                   |
| ---- | ----------------------- | -------------------------------------- |
| 1    | `relevant_law_ids` 有值 | 使用 enrichment 結果                   |
| 2    | 空 + 有 `dispute_id`    | 從 `perIssueAnalysis.key_law_ids` 推導 |
| 3    | 仍為空                  | Fallback 到 ALL found laws             |

```bash
node scripts/pipeline-test/test-law-fallback.mjs
```

- 不需要 dev server 或外部服務
- 純邏輯測試，秒級完成
- 7 個測試案例覆蓋所有 tier 和邊界情況

### 2. `pipeline-benchmark.mjs` — Integration Benchmark

對指定案件跑 N 次完整 pipeline，自動收集 citation 統計並輸出比較表。

```bash
# 預設：跑 3 次，使用車禍測試案件
node scripts/pipeline-test/pipeline-benchmark.mjs

# 自訂參數
node scripts/pipeline-test/pipeline-benchmark.mjs --runs 5 --case-id YOUR_CASE_ID --url http://localhost:5173
```

**參數：**

| 參數        | 預設值                  | 說明                          |
| ----------- | ----------------------- | ----------------------------- |
| `--runs`    | `3`                     | Pipeline 執行次數             |
| `--case-id` | `z4keVNfyuKvL68Xg1qPl2` | 測試案件 ID（車禍損害賠償案） |
| `--url`     | `http://localhost:5173` | Dev server URL                |

**前提條件：**

- Dev server 正在運行（`npm run dev`）
- 本地 D1 有測試案件資料
- AUTH_TOKEN 從 `dist/lexdraft/.dev.vars` 自動讀取

**流程：**

```
1. 檢查 dev server 是否可連線
2. 讀取 baseline（最新既有 brief 的 citation 統計）
3. 對每次 run：
   a. POST /api/cases/:id/chat 觸發 pipeline
   b. 監聽 SSE 串流，顯示即時進度
   c. Pipeline 完成後查 D1 取得新 brief
   d. 解析 content_structured 提取 citation 統計
4. 輸出比較表 + per-section 明細
5. 儲存結果至 benchmark-results.json
```

**輸出指標：**

| 指標            | 說明                                           |
| --------------- | ---------------------------------------------- |
| `Law cites`     | 法條引用總數                                   |
| `File cites`    | 檔案引用總數                                   |
| `Total cites`   | 引用總數                                       |
| `Paragraphs`    | 段落數量                                       |
| `Total chars`   | 總字數                                         |
| `0-law content` | 內容段落（排除前言/結論）中法條引用為 0 的數量 |
| `0-cite all`    | 所有段落中完全無引用的數量                     |
| `Time (s)`      | Pipeline 執行時間                              |

**範例輸出：**

```
═══════════════════════════════════════════════════════════
 Benchmark Results
═══════════════════════════════════════════════════════════

      Metric │     Baseline │        Run 1 │        Run 2 │        Run 3 │          Avg
─────────────┼──────────────┼──────────────┼──────────────┼──────────────┼─────────────
   Law cites │           11 │           18 │           16 │           13 │         15.7
  File cites │           30 │           46 │           43 │           44 │         44.3
 Total cites │           41 │           64 │           59 │           57 │         60.0
  Paragraphs │            8 │            8 │            8 │            8 │          8.0
0-law content │          2/6 │          1/6 │          2/6 │          1/6 │            -
  0-cite all │          2/8 │          0/8 │          1/8 │          1/8 │            -
    Time (s) │            - │        396.6 │        232.3 │        239.3 │        289.4
```

## 測試案件

**車禍損害賠償案**（`z4keVNfyuKvL68Xg1qPl2`）：

- 原告騎機車遭被告闖紅燈撞擊
- 6 個爭點：侵權責任、醫療費用、交通費用、不能工作損失、機車修復、精神慰撫金
- 預期書狀結構：8 段落（前言 + 6 內容 + 結論）
- 涉及法條：民法 §184, §191-2, §193, §195, §196, §217

## 結果檔案

- `benchmark-results.json` — 最新一次 benchmark 的完整結果（含 per-section 明細）
- 歷史結果可透過 git history 追溯

## 何時該跑測試

- 修改 `contextStore.ts`（law/file context 分配邏輯）→ 跑 unit test
- 修改 `reasoningStrategyStep.ts`（Reasoning/Structuring 邏輯）→ 跑 benchmark
- 修改 `writerStep.ts`（Writer prompt 或 document 組裝）→ 跑 benchmark
- 修改 `strategyConstants.ts` 或 `reasoningStrategyPrompt.ts`（prompt）→ 跑 benchmark
- 修改 `aiClient.ts`（token limit、API 設定）→ 跑 benchmark

## 品質基線

最新基線（2026-03-03，law fallback + truncation fix 後）：

| Metric        | Avg (3 runs) | Best | Worst |
| ------------- | ------------ | ---- | ----- |
| Law cites     | 15.7         | 18   | 13    |
| File cites    | 44.3         | 46   | 43    |
| Total cites   | 60.0         | 64   | 57    |
| 0-law content | 1.3/6        | 1/6  | 2/6   |

歷史版本對比見 MEMORY.md 的 Citation Benchmarks 表格。
