# ADR-001: Gemini 3.1 Flash Lite 評估與採用決策

**日期**: 2026-03-05
**狀態**: 已決定
**決策者**: Eric Wu

## 背景

Google 發布 Gemini 3.1 Flash Lite（`gemini-3.1-flash-lite-preview`），定價 $0.25/M input、$1.50/M output，速度比 2.5 Flash 快約 10 倍。評估是否能替代 pipeline 中的 Gemini 2.5 Flash 以降低成本和延遲。

## 評估範圍

| Pipeline 步驟              | 現行模型                | 是否評估 | 結果   |
| -------------------------- | ----------------------- | -------- | ------ |
| Step 0 (Issue Analyzer)    | Gemini 2.5 Flash        | 是       | 不採用 |
| Step 2a (Reasoning)        | Claude Haiku 4.5        | 否       | —      |
| Step 2b (Structuring JSON) | Gemini 2.5 Flash native | 無法測試 | 待定   |
| Step 3 前言/結論           | Gemini 2.5 Flash native | 是       | 採用   |
| Step 3 內容段落            | Claude Sonnet 4.6       | 否       | —      |

## 決策

**只在 Step 3 前言/結論採用 Gemini 3.1 Flash Lite**，其餘步驟維持不變。

## 技術限制：AI Gateway 路由

Cloudflare AI Gateway 的 `google-ai-studio` provider 尚未支援 `gemini-3.1-flash-lite-preview`（stored key 無法注入），因此 3.1 Flash Lite 必須透過 OpenRouter provider 路由。

### OpenRouter 認證要求

OpenRouter 透過 AI Gateway 需要兩個 header：

```
cf-aig-authorization: Bearer <token>
cf-aig-byok-alias: lex-draft-openrouter    ← 必要，否則 401
```

`cf-aig-byok-alias` 對應 AI Gateway 後台設定的 OpenRouter stored key 別名。缺少此 header 會回傳 `401 No cookie auth credentials found`，錯誤訊息具誤導性（與 cookie 無關，實為 stored key lookup 失敗）。

此限制也記錄在 `CLAUDE.md` 的 AI Gateway 認證表格中。

## Step 0 評估結果

使用相同車禍案件（case z4keVNf）的 Issue Analyzer 做 A/B 比較。

### 直接輸出比較

| 指標             | 2.5 Flash | 3.1 Flash Lite |
| ---------------- | --------- | -------------- |
| 耗時             | 11,876ms  | 984ms          |
| Output tokens    | 1,950     | 1,127          |
| Legal issues     | 2         | 2              |
| Information gaps | 6         | 2              |

3.1 Flash Lite 的 Issue Analyzer 輸出較精簡：傾向合併描述（如將多項損害賠償合併為一個事實），而 2.5 Flash 逐項展開（每項費用獨立一個 fact）。

### 下游影響（Step 2 端到端）

將兩組 Step 0 輸出分別接入完整 Step 1 + Step 2 pipeline：

| 指標             | 2.5 Flash 輸入 | 3.1 Flash Lite 輸入 |
| ---------------- | -------------- | ------------------- |
| Step 2 耗時      | 170.9s         | 109.1s              |
| Sections         | 8              | 4                   |
| Claims           | 15             | 11                  |
| Total law refs   | 27             | 9                   |
| Sections w/ laws | 6              | 2                   |

3.1 Flash Lite 的精簡輸出導致 Step 2 推理引擎產出較粗略的論證策略：車禍案件本應逐項（醫療、交通、工損、財損、慰撫金）分段論證，但 3.1 Flash Lite 的輸出使推理引擎將所有損害合併為單一段落。這在實務上品質不足。

**結論**：Step 0 不採用 3.1 Flash Lite。

## Step 2b 無法測試的原因

Step 2b（Structuring JSON）使用 `callGeminiNative()` + `responseSchema` constrained decoding，確保 JSON 輸出 100% 符合 schema。此功能依賴 Google AI Studio 原生端點。

由於 3.1 Flash Lite 只能走 OpenRouter（OpenAI-compatible endpoint），不支援 `responseSchema`。之前從 compat endpoint 換到 native + constrained decoding 時，validation pass rate 從 67% 升到接近 100%。沒有 constrained decoding 的比較不公平，也不實用。

**未來條件**：當 Cloudflare AI Gateway 支援 `google-ai-studio/gemini-3.1-flash-lite-preview` 後，可用原生端點 + responseSchema 重新評估。

## Step 3 前言/結論評估結果

前言/結論使用 `text/plain` 輸出，不需要 `responseSchema` 或 Citations API，可透過 OpenRouter 呼叫。

| 指標           | 2.5 Flash    | 3.1 Flash Lite |
| -------------- | ------------ | -------------- |
| 前言耗時       | 8,860ms      | 3,261ms (2.7x) |
| 結論耗時       | 7,564ms      | 2,020ms (3.7x) |
| 前言字數       | 255          | 387            |
| 結論字數       | 187          | 216            |
| 法律用語正確性 | 好           | 好             |
| 格式遵從       | 結論多出標題 | 正確           |

品質相當，速度快約 3 倍。前言略長（展開法條意旨），結論品質甚至稍好（無多餘標題、有完整利息請求）。

**結論**：Step 3 前言/結論採用 3.1 Flash Lite。

## Step 3 前言/結論事實幻覺修正（2026-03-06）

### 問題

採用 3.1 Flash Lite 後，前言/結論出現三項事實錯誤：

| 編號 | 問題                | 原因                                                                                       |
| ---- | ------------------- | ------------------------------------------------------------------------------------------ |
| P1   | 年份錯誤（113→114） | prompt 中唯一年份資訊是 `caseMetadata.caseNumber: "114年"`（案號年度），模型誤用為事故年度 |
| P2   | 虛構「答辯狀」      | prompt 規則提及「被告於答辯狀自承」用語，模型據此推測存在答辯狀                            |
| P3   | 傷勢描述不一致      | 無具體傷勢資料，模型自行推測（如「左膝韌帶扭傷」）                                         |

### 根因

前言/結論的 `instruction` 包含 claims、argumentation、caseMetadata，但**缺少 `caseSummary`**（848 字，由 Step 0 從文件摘要合成）。模型沒有事實依據，只能從 metadata 推測。

### 修正

在 `writerStep.ts` 中，對 `!dispute_id` 的段落（前言/結論）注入結構化事實：

```
[案件事實摘要]  ← store.caseSummary（848 chars）
[爭點列表]      ← store.legalIssues
[賠償項目]      ← store.damages
[本段撰寫範圍]  ← 前言/結論各自的 scope 規則（字數、內容限制）
```

### 驗證

使用 snapshot replay（case z4keVNf, step0+step2）測試修正後的 prompt：

| 檢查項               | 修正前        | 修正後      |
| -------------------- | ------------- | ----------- |
| P1 年份正確（113年） | ❌ 114年      | ✅ 113年    |
| P2 無虛構答辯狀      | ❌ 提到答辯狀 | ✅ 未提到   |
| P3 傷勢與摘要一致    | ❌ 推測傷勢   | ✅ 依照摘要 |
| 字數 150-300         | ✅            | ✅          |
| 不含個別金額         | ✅            | ✅          |

### 關鍵洞察

模型選擇（Gemini vs Haiku）不是幻覺的根本原因。Haiku 在相同缺失 context 下也會過度展開（收到全部 6 份文件 → 寫出 2239 字完整書狀）。正確做法是提供**適量的結構化摘要**（`caseSummary` 848 chars），而非完整文件或完全不給。

## 實作變更

- `src/server/agent/aiClient.ts`：新增 `callOpenRouterText()` 函式
- `src/server/agent/pipeline/writerStep.ts`：`isIntroOrConclusion` 分支改用 `callOpenRouterText`；注入 `caseSummary` + `damages` + `legalIssues` + scope 規則修正幻覺

## 測試腳本

以下腳本保留供未來模型評估復用：

- `scripts/test-step0-compare.ts` — Step 0 Issue Analyzer A/B 比較
- `scripts/test-step2-compare.ts` — Step 2 端到端 A/B 比較（含 Step 1 law fetch）
- `scripts/test-writer-compare.ts` — Step 3 前言/結論寫作 A/B 比較
