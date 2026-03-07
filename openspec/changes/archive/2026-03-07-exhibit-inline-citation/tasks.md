## 1. 中文數字 Label 基礎

- [x] 1.1 將 `evidenceFormatter.ts` 的 `toChineseNumber()` 搬到 `exhibitAssign.ts` 作為 shared export
- [x] 1.2 在 `exhibitAssign.ts` 新增 `toChineseExhibitLabel(prefix: string, number: number): string`，回傳「甲證一」格式
- [x] 1.3 更新 `evidenceFormatter.ts` 改為 import shared `toChineseNumber`
- [x] 1.4 驗證：`toChineseExhibitLabel('甲證', 1)` → `'甲證一'`，`toChineseExhibitLabel('甲證', 12)` → `'甲證十二'`

## 2. Writer Prompt 注入 ExhibitMap

- [x] 2.1 在 `briefPipeline.ts` Step 3 開始前，從 exhibits 表查詢 case 的所有 exhibits，建構 `Map<fileId, chineseLabel>`
- [x] 2.2 將 exhibitMap 傳入每個 `writeSection()` 呼叫（新增函式參數）
- [x] 2.3 在 `writerStep.ts` 的 `docListText` 建構邏輯中，為每個 file document 附加中文證物編號（如 `「01_交通事故初步分析研判表.pdf」（甲證一）`）
- [x] 2.4 在撰寫規則中新增兩條證物引用指引（首次引用格式 + 再次引用簡寫）
- [x] 2.5 確認前言/結論段不注入 exhibitMap（`isIntroOrConclusion` 判斷已存在）
- [x] 2.6 Pipeline 完成後，為每個 file citation 添加 `exhibit_label` 欄位（中文格式）

## 3. Citation 類型宣告更新

- [x] 3.1 在 `useBriefStore.ts` 的 `Citation` type 新增 optional `exhibit_label?: string` 欄位
- [x] 3.2 確認 `shared/types.ts` 如有 Citation type 也同步更新（無需修改）

## 4. ExhibitMark Tiptap Extension

- [x] 4.1 建立 `src/client/components/editor/tiptap/extensions/ExhibitMark.ts`，定義 Tiptap Mark（attrs: file_id, quoted_text, label, citation_id）
- [x] 4.2 建立 `src/client/components/editor/tiptap/extensions/ExhibitMarkView.tsx`，實作 hover popover + click 開檔功能（從 CitationNodeView 複用 popover 邏輯）
- [x] 4.3 在 A4PageEditor 的 Tiptap extensions 列表中註冊 ExhibitMark
- [x] 4.4 實作段落渲染前的 post-process：掃描 citations（type=file）→ 用 exhibitMap 取得中文 label → 在 content_md/segments 中定位該 label → 套用 ExhibitMark

## 5. CitationNode 調整（僅保留 Law）

- [x] 5.1 修改段落渲染邏輯：file citation 不再產生 CitationNode，改由 ExhibitMark 處理
- [x] 5.2 確認法條 CitationNode 渲染不受影響
- [x] 5.3 清理 CitationNodeView 中的 `useExhibitLabel` 和 `exhibitLabel` 相關邏輯（不再需要）

## 6. Word 匯出調整

- [x] 6.1 修改 `exportDocx.ts` 的 `buildCitationText()`：file type 回傳空字串
- [x] 6.2 確認 law type 匯出格式不變
- [x] 6.3 測試匯出結果：正文中有「（甲證一）」，不出現重複

## 7. Exhibit 重排同步

- [x] 7.1 在 `useBriefStore` 新增 `syncExhibitLabels(oldMap, newMap)` 方法
- [x] 7.2 實作 swap-safe 替換策略：先用 file_id placeholder 替換所有舊 label，再替換 placeholder 為新 label
- [x] 7.3 替換範圍限定：只處理含有受影響 file citation 的段落
- [x] 7.4 同步更新 citation 的 `exhibit_label` 欄位
- [x] 7.5 替換完成後 persist 到 briefs 表（dirty=true 觸發 autoSave）
- [x] 7.6 在 ExhibitsTab 的 reorder/delete 操作後觸發 `syncExhibitLabels`

## 8. 端到端驗證

- [ ] 8.1 跑一次完整 pipeline，確認正文包含「有○○可稽（甲證X）」格式
- [ ] 8.2 確認 editor 中「甲證X」文字有藍色樣式 + hover popover + click 開檔
- [ ] 8.3 確認法條 badge 不受影響
- [ ] 8.4 在 ExhibitsTab 重排，確認正文編號同步更新
- [ ] 8.5 匯出 Word，確認無重複證物編號
- [x] 8.6 Prettier 格式化所有修改檔案
