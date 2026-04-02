## Overview

改善 CaseWorkspace 各面板和 CaseList 的空狀態，從「這裡是空的」升級為「這裡會出現什麼 + 怎麼觸發」。

## Requirements

### CaseList 空狀態（`CaseList.tsx`）

現有：dashed border box +「尚無案件」+「點擊『新建案件』開始使用」

改為：
- 標題：三步驟說明流程
  1. 建立案件 — 輸入案名和我方立場
  2. 上傳文件 — 起訴狀、答辯狀、證據等 PDF
  3. AI 生成 — 自動分析爭點並撰寫書狀
- 兩個 CTA 並排：「新建案件」（primary）+「查看範例案件」（ghost，navigate `/demo`）

### Editor Panel 空狀態（`EditorPanel.tsx`）

現有：「請從右側面板選擇書狀或檔案」

改為：
- 「從右側面板選擇內容」
- 列出三種可開啟的內容 + 來源位置：
  - 書狀草稿 — 在「卷宗」tab
  - 案件文件 — 在「卷宗」tab
  - 法條全文 — 點擊書狀中的法條引用

### 爭點 tab 空狀態（`DisputesTab.tsx`）

現有：Search icon +「尚未分析爭點」+ EmptyAnalyzeButton

改為：
- 說明文字：「AI 會從你的文件中自動歸納」
- 3 bullet points：雙方爭執要點及各自主張、不爭執事項、對應證據與法條
- Mini preview 區塊（淺色背景卡片）：
  ```
  爭點一：醫療費用是否合理
    我方：主張 NT$125,000
    對方：僅認 NT$80,000
  ```
- CTA：保留 EmptyAnalyzeButton
- 條件提示：若無 ready 檔案，顯示「需先上傳案件文件」

### 卷宗 — 書狀草稿空狀態（`BriefsSection.tsx`）

現有：「尚無書狀」

改為：
- 「尚無書狀」
- 「透過左側 AI 助理對話來生成」
- 可選：小箭頭指向左側面板方向

### 卷宗 — 檔案空狀態（`FilesSection.tsx`）

現有：Upload icon +「尚無檔案」+ 上傳 PDF 按鈕

改為：
- Upload icon
- 「上傳案件文件」（比「尚無檔案」更行動導向）
- 副文字：「起訴狀、答辯狀、證據等 PDF」
- 上傳按鈕保留

### 時間軸 tab 空狀態（`TimelineTab.tsx`）

現有：Calendar icon +「尚未產生時間軸」+「手動新增」+ EmptyAnalyzeButton

改為：
- 說明文字：「AI 會按時間排列案件事實」
- 副文字：「包含事故日期、就醫紀錄、調解過程等」
- CTA：保留手動新增 + EmptyAnalyzeButton
- 條件提示：若無 ready 檔案，顯示「需先上傳案件文件」

### ChatPanel 空狀態

**不改動**。現有 4 個快捷按鈕已是有效的引導。

## Design Principles

- 文案使用中文，簡短直接
- 使用 lucide-react icon，不用 emoji
- 配色延用現有 dark theme tokens（text-t2, text-t3, bg-bg-2, border-bd）
- Mini preview 用 `bg-bg-2 rounded-lg border border-bd` 卡片樣式
- 不超過 sidebar 寬度（352px），注意文字換行
