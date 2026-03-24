## Context

目前 pipeline 的 briefMode 有 5 種值，但 reasoning prompt 只根據 PipelineMode（claim/defense）切換 workflow。supplement（準備書狀）和 challenge（上訴狀）缺少對應的焦點文件 context，導致 AI 無法做到「逐點回應對方主張」或「逐點指出判決錯誤」。

卷宗分類現為 5 類：`brief`（書狀不分敵我）、`exhibit_a`、`exhibit_b`、`court`（判決筆錄混在一起）、`other`。pipeline 無法從中過濾出「對方書狀」或「判決」。

我方書狀是可編輯的 briefs 表資料，顯示在編輯器區域，不在卷宗側邊欄。卷宗側邊欄的檔案都是上傳的唯讀參考資料。

## Goals / Non-Goals

**Goals:**
- 卷宗分類能區分「對方書狀」和「判決」，律師可在 sidebar 看到並手動修正
- supplement 模式下，reasoning prompt 包含對方書狀的結構化內容
- challenge 模式下，reasoning prompt 包含判決的結構化內容
- briefMode-specific 的 overlay 指引讓 AI 知道具體任務（逐點回應 / 逐點指出錯誤）
- 不改 PipelineMode 二元邏輯（claim/defense），overlay 是追加在 base workflow 之上
- 向後相容：舊檔案的 `brief`、`court` 值仍可正常顯示

**Non-Goals:**
- 不為 supplement/challenge 建立獨立的 reasoning workflow（用 overlay 追加即可）
- 不對焦點文件做預分析（直接用 content_md 注入，讓 reasoning model 自行分析）
- 不新增 `brief_ours` 分類（我方書狀在 briefs 表，不在 files 卷宗）
- 不拆分 court 為 ruling/transcript（只拆出 judgment，其餘留在 court）
- 不做前端「建議上傳對造書狀」的提示（未來再做）
- 不需要 DB migration

## Decisions

### D1: 分類從 5→6 類，移除 `brief` 改為 `brief_theirs`，從 `court` 拆出 `judgment`

```
舊                新
───               ──
brief          →  brief_theirs (對方書狀)
exhibit_a      →  exhibit_a (不變)
exhibit_b      →  exhibit_b (不變)
court          →  judgment (判決) + court (裁定/筆錄/通知)
other          →  other (不變)
```

**為什麼移除 `brief` 而不是拆成 `brief_ours` + `brief_theirs`**：我方書狀是在 briefs 表中編輯的，不會出現在 files 卷宗中。卷宗裡上傳的書狀幾乎都是對方的。極少數情況（上傳自己之前提過的書狀 PDF）歸到 `other` 即可。

**為什麼只拆 judgment 不拆 ruling/transcript**：pipeline 只需要判決（challenge 模式），裁定和筆錄對 pipeline 沒有特殊用途。多拆只增加分類複雜度。

**替代方案**：加 `doc_subtype` 隱藏欄位 → 否決，因為律師看不到就改不了，AI 分錯時無法手動修正。

### D2: 焦點文件直接用 content_md，統一截斷常數

焦點文件用 `FOCUS_DOC_MAX_LENGTH = 8000` 字截斷後注入 Step 2 reasoning prompt。

- 用 `content_md`（有 `##` 結構的 markdown），fallback 到 `full_text`
- 不做預分析，讓 reasoning model 自行讀取和分析
- 如果有多份同類型文件（如多份對方書狀），全部注入，各自截斷

### D3: Overlay 追加模式，不修改 base workflow

```
buildReasoningSystemPrompt(mode, briefMode)
  │
  ├─ base workflow（按 PipelineMode，不動）
  │   claim  → COMPLAINT_REASONING_WORKFLOW
  │   defense → DEFENSE_REASONING_WORKFLOW
  │
  └─ + overlay（按 briefMode，新增）
      supplement → SUPPLEMENT_OVERLAY
      challenge  → CHALLENGE_OVERLAY
      其他       → 無 overlay
```

Overlay 內容只是追加指引，不替換 base workflow。效果是 AI 既知道攻/防策略（base），也知道具體任務（overlay）。

### D4: User message 中的焦點專區位置

在 `buildReasoningStrategyInput()` 的 `[案件檔案摘要]` 之後、`[Information Gaps]` 之前插入：

```
supplement:
  ═══ 對造書狀（你需要逐點回應） ═══
  【被告民事答辯狀】(file_id)
  (content_md 截斷內容)

challenge:
  ═══ 原審判決（你需要逐點指出錯誤） ═══
  【臺灣○○地方法院判決】(file_id)
  (content_md 截斷內容)
```

沒有焦點文件時，專區不出現，overlay 指引仍然注入（graceful degradation）。

### D5: briefMode 的傳遞路徑

```
ctx.briefMode (PipelineContext)
  → briefPipeline.ts: 提取焦點文件，放入 strategyInput
  → reasoningStrategyStep.ts: 傳給 buildReasoningSystemPrompt + buildReasoningStrategyInput
  → reasoningStrategyPrompt.ts: 組裝 overlay + 專區
```

目前 `buildReasoningSystemPrompt(mode: PipelineMode)` 只接收 PipelineMode。改為 `buildReasoningSystemPrompt(mode: PipelineMode, briefMode: BriefModeValue | null)` 追加參數。

### D6: 向後相容處理

舊檔案 `category = 'brief'` 或 `category = 'court'` 在 categoryConfig 加 fallback entry：

```
'brief' → 顯示為 [對] 對方書狀（等同 brief_theirs）
'court' → 顯示為 [法] 法院文件（保持現有行為）
```

pipeline 過濾時也同時匹配舊值：
```
supplement: category === 'brief_theirs' || category === 'brief'
challenge:  category === 'judgment'（舊 court 不匹配，需手動改分類）
```

## Risks / Trade-offs

**[AI 分類準確率]** — AI 區分「對方書狀」vs 其他文件通常很準（書狀格式明顯），但判決 vs 裁定的區分偶爾可能出錯 → 律師可在 sidebar 手動修正分類

**[content_md 品質]** — content_md 由 fileProcessor 的 markdown 轉換 AI 生成，品質依賴 PDF 提取和 AI 轉換 → 已有 full_text fallback，且 reasoning model 足以處理非結構化文本

**[焦點文件截斷]** — 8000 字可能截斷長判決的重要後半部 → 判決的關鍵認定通常在前半段（主文 + 事實及理由），如果不夠未來調整常數即可

**[多份焦點文件]** — 案件可能有多份對方書狀（起訴狀 + 答辯狀 + 準備書狀），全部注入可能過長 → v1 先全部注入各自截斷，如果 prompt 過長未來可改為只取最新一份（按 doc_date 排序）
