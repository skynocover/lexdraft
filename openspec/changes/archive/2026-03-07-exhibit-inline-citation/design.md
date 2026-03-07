## Context

目前書狀 pipeline 的 citation 系統分為兩層：
1. **資料層**：每個段落的 `citations` 陣列存有 `file_id`、`quoted_text`、`type` 等資訊
2. **顯示層**：Tiptap 的 `CitationNode` 將 file/law citations 都渲染為獨立的 inline badge（縮小字體，藍/紫色背景）

律師實務中，證物引用是正文的一部分：「有鑑定意見書可稽（甲證一）」。目前系統的 badge 與此慣例脫節。

Exhibits 系統已完整：上傳時自動分配編號、ExhibitsTab 可重排、Word 匯出用 exhibitMap 替換 label。缺的是讓 AI 在寫作時使用這些編號，以及讓正文中的編號成為互動元素。

## Goals / Non-Goals

**Goals:**
- AI 撰寫的書狀正文自然包含「有○○可稽（甲證X）」格式的證物引用
- 正文中的「甲證X」文字本身可 hover/click，提供引文原文和開檔功能
- 律師重排證物後，正文中的編號自動同步更新
- 統一使用中文數字（甲證一、甲證二）

**Non-Goals:**
- 前言/結論段的證物引用（這兩段由 Gemini Flash 撰寫，不需要 citations）
- 改動法條 citation badge 的行為（維持現狀）
- 改動 exhibits 表的資料結構
- 自動偵測 AI 遺漏的證物引用（先信任 prompt 品質）

## Decisions

### D1: File citation 從 CitationNode 改為 Tiptap Mark

**選擇**：新建 `ExhibitMark` Tiptap extension（Mark 類型），取代 file citation 的 `CitationNode`（Node 類型）。

**理由**：Mark 是貼在既有文字上的樣式（類似超連結），正好適合「甲證一」這幾個字需要有互動功能的場景。Node 是獨立元素，適合法條 badge 這種不屬於正文的標註。

**替代方案**：用 decoration 或 plugin 做 highlight → 不夠穩定，且無法攜帶 attrs（file_id、quoted_text）。

### D2: 中文數字轉換共用函式

**選擇**：在 `exhibitAssign.ts` 新增 `toChineseExhibitLabel(prefix, number)` → 回傳「甲證一」。複用 `evidenceFormatter.ts` 現有的 `toChineseNumber()`（搬到 `exhibitAssign.ts` 作為 shared 函式）。

**理由**：`buildExhibitLabel` 回傳「甲證1」（阿拉伯數字），用於 UI badge 和內部邏輯。正文和證據方法需要「甲證一」（中文數字）。兩個函式並存，各司其職。

### D3: Prompt 注入策略

**選擇**：在 `writerStep.ts` 的 `docListText` 區塊，為每個 file document 附加中文證物編號：

```
[提供的來源文件]（你必須從這些文件中引用）
  案件文件：「01_交通事故初步分析研判表.pdf」（甲證一）
  案件文件：「02_診斷證明書.pdf」（甲證三）
```

並在撰寫規則加入：
```
- 引用案件文件時，必須在文件通稱後附加證物編號，格式：「有○○可稽（甲證X）」或「有○○為證（甲證X）」
- 同一段落再次引用同一文件時，可直接使用「甲證X」不需重複通稱
```

**理由**：Writer prompt 是唯一能讓 AI 自然行文的地方。後處理無法產生「可稽」「附卷可參」等銜接語。

### D4: 重排同步機制

**選擇**：在 `useBriefStore` 中，當 exhibits 變更時，遍歷所有段落的 citations，比對每個 file citation 的 `file_id` 在新 exhibitMap 中的 label。若段落 `content_md` 中包含舊 label（如「甲證一」），替換為新 label（如「甲證三」）。同時更新 `segments` 中的對應文字。

為支援此機制，pipeline 完成時在每個 file citation 物件上新增 `exhibit_label` 欄位，記錄 pipeline 時的證物編號（如「甲證一」），作為替換時的「舊值」查找依據。

**替代方案**：只在 render 層做替換（不改 content_md）→ 但 Word 匯出和版本快照都會保留舊編號，不一致。

### D5: Word 匯出調整

**選擇**：`exportDocx.ts` 的 `buildCitationText()` 對 file type 回傳空字串（不再插入「（甲證X）」），因正文已包含。法條維持現狀。

### D6: ExhibitMark 的 post-process 匹配策略

**選擇**：段落渲染進 Tiptap 前，掃描每個段落的 `citations`（type=file），用 `exhibitMap` 取得該 file_id 的中文 label（如「甲證一」），然後在 `content_md` / `segments` 中找到該 label 文字，對該範圍套用 `ExhibitMark`（attrs: file_id, quoted_text, label）。

匹配順序：先找「（甲證X）」括號內的文字，再找裸出現的「甲證X」。

## Risks / Trade-offs

**[AI 可能不遵守 prompt 格式]** → 加入 post-process 驗證：若段落有 file citations 但 content_md 中找不到任何「甲證X」，fallback 為在段尾插入「（甲證X）」。低機率，Sonnet 4.6 prompt following 能力強。

**[重排時正則替換誤中]** → 「甲證一」出現在非引用語境的機率極低（這是高度特定的法律術語）。且替換只在有對應 citation file_id 的段落內進行，不會全域替換。

**[ExhibitMark 與 CitationNode 共存複雜度]** → 法條用 CitationNode，檔案用 ExhibitMark。段落渲染時按 citation type 分流，邏輯清晰。現有的 `CitationNodeView` popover 邏輯可大量複用。

**[中文數字對照限制]** → `toChineseNumber()` 目前支援到 99。exhibits 超過 99 個的案件極罕見，暫不處理。
