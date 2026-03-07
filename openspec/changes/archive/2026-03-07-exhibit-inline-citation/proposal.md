## Why

書狀正文缺乏證物編號引用（如「有鑑定意見書可稽（甲證一）」），是律師無法直接使用 AI 產出的最大障礙之一。目前 citation badge 以獨立標籤顯示在文字後方，與律師實務的行文慣例脫節——實務上證物編號是正文句子的一部分，不是旁註。

## What Changes

- **Writer prompt 注入 exhibitMap**：pipeline Step 3 Writer 寫作時，prompt 告知每個案件文件對應的證物編號（中文數字格式），讓 AI 在行文中自然寫出「有○○可稽（甲證X）」
- **File citation badge 改為 inline mark**：正文中的「甲證一」文字本身成為互動元素（藍色底/超連結風格），取代原本獨立的 file citation badge。hover 顯示引文原文，click 開啟來源檔案
- **法條 citation badge 維持不變**：法條引用仍用現有的 CitationNode badge
- **中文數字統一**：新增 `toChineseExhibitLabel()` 函式，正文和證據方法段統一使用「甲證一」格式；ExhibitsTab UI 保留簡寫「甲1」
- **Word 匯出調整**：file citation marker 不再插入「（甲證X）」括號文字，因正文已包含
- **Exhibit 重排同步**：律師在 ExhibitsTab 重排證物後，自動更新 content_md 和 segments 裡的舊編號文字

## Capabilities

### New Capabilities
- `exhibit-inline-mark`: 將正文中的證物編號文字（如「甲證一」）渲染為 Tiptap Mark，提供 hover/click 互動功能，取代 file citation 的獨立 badge
- `exhibit-prompt-injection`: Pipeline Writer step 注入 exhibitMap 至 prompt，讓 AI 以律師慣用句式撰寫證物引用
- `exhibit-reorder-sync`: 律師重排證物編號後，自動更新書狀正文中的舊證物編號文字

### Modified Capabilities

（無既有 spec 需修改）

## Impact

- **後端**：`writerStep.ts`（prompt 注入）、`briefPipeline.ts`（載入 exhibitMap 傳入 writer）、`exhibitAssign.ts`（新增中文數字 label 函式）
- **前端**：新增 `ExhibitMark` Tiptap extension、修改 `CitationNodeView.tsx`（僅保留 law badge）、修改 `A4PageEditor.tsx`（file citation 改用 mark 渲染）
- **匯出**：`exportDocx.ts`（file citation 不再插入括號文字）
- **資料結構**：`content_md` 將包含「（甲證X）」文字；`segments` 和 `citations` 結構不變
- **前言/結論段**：不受影響（Gemini Flash 寫的段落不注入 exhibitMap）
