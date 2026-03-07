## Why

目前 pipeline 產出的書狀只有「事實及理由」的主體內容（前言 → 依爭點展開 → 結論），缺少法院書狀的必要格式：訴之聲明（P1-1）和書狀首尾（P1-6）。法官收到這份書狀會認為格式不完整。這是書狀品質的基礎問題，必須在其他功能之前解決。

## What Changes

- 新增 `briefAssembler.ts`：根據 brief_type 的 config 對照表，用程式碼組裝書狀的 header（法院、案號、當事人）、declaration（訴之聲明/答辯聲明）、footer（謹狀、法院、具狀人）
- 修改 `briefPipeline.ts`：在 AI 產出的 body 段落前後插入 assembler 組裝的段落
- 修改 `strategyConstants.ts`：調整 `BRIEF_STRUCTURE_CONVENTIONS` 的段落編號，讓 AI body 從正確編號開始（如起訴狀從「貳」開始，因為「壹」是訴之聲明）

## Capabilities

### New Capabilities
- `brief-assembly`: 根據 brief_type 和 cases/damages 表資料，自動組裝書狀的結構化段落（header、declaration、footer），插入 AI 生成的 body 前後，產出完整格式的法院書狀

### Modified Capabilities

（無既有 spec）

## Impact

- `src/server/agent/pipeline/briefAssembler.ts`（新建）：config 對照表 + 3 個組裝函式
- `src/server/agent/briefPipeline.ts`（修改）：Step 3 完成後插入組裝段落
- `src/server/agent/prompts/strategyConstants.ts`（修改）：4 種 brief_type 的段落編號調整
- 不改 DB schema、不改前端、不改 AI prompt 結構
