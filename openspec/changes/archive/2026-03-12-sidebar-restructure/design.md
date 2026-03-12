## Context

右側 sidebar 目前有 3 個頂層 tab（案件資訊/卷宗檔案/分析）+ 分析 tab 下 3 個 sub-tab（爭點/金額/時間軸）。撰寫書狀時最常用的「爭點」需要 2 次點擊才到達，且金額和爭點分散在不同 sub-tab。

現有組件結構：
- `RightSidebar.tsx` — 頂層 tab 容器
- `DisputesTab.tsx` — 爭點列表 + DisputeCard
- `DamagesTab.tsx` — 金額列表（按財產/非財產分組）
- `DamageCard.tsx` — 單一金額項目
- `DamageGroup.tsx` — 金額分組容器
- `DamageFormDialog.tsx` — 金額新增/編輯表單
- `TimelineTab.tsx` — 時間軸
- `useUIStore` — 管理 `sidebarTab`、`analysisSubTab`、`caseMaterialSections`
- `useAnalysisStore` — 管理 disputes、damages、timeline 資料

DB 的 `damages` 表已有 `dispute_id` 欄位，但前端 `Damage` interface 沒有包含。

## Goals / Non-Goals

**Goals:**
- 爭點成為頂層 tab，1 次點擊到達
- 金額嵌入爭點卡片（混合模式：header 顯示總額 + 展開顯示明細）
- 保留金額的完整 CRUD 能力
- 時間軸仍可存取（低頻使用，摺疊於爭點 tab 底部）
- 前端 Damage type 補上 dispute_id，實現爭點-金額關聯

**Non-Goals:**
- 不做 editor 游標追蹤爭點的連動（未來可加）
- 不改案件資訊 tab
- 不改卷宗 tab 內部結構
- 不改後端 API 結構（dispute_id 已存在於 DB，只需前端取用）

## Decisions

### 1. Tab 結構：移除「分析」tab，爭點升頂層

**決定**：頂層 tab 變為 [案件資訊] [爭點] [卷宗]

**替代方案**：保留分析 tab 但移除 sub-tab（爭點/金額/時間軸改為 collapsible sections）
**為何不選**：爭點是撰寫核心，值得頂層入口；分析 tab 作為容器沒有獨立價值。

### 2. 金額嵌入方式：混合模式

**決定**：
- DisputeCard header 顯示該爭點的金額小計（摺疊可見）
- DisputeCard 展開後，在論證區下方顯示 inline 金額列表 + 新增按鈕
- 每個金額項目可展開看 basis、可編輯/刪除
- 底部獨立區塊放 `dispute_id = null` 的未分類金額
- 底部 sticky bar 顯示請求總額

**替代方案 A**：只在 header 顯示金額，不展開明細 → 失去 CRUD
**替代方案 B**：金額區塊用完整 card-in-card → 展開後爭點卡片太長

### 3. 金額按 dispute_id 分組

**決定**：前端 `Damage` interface 補上 `dispute_id: string | null`，API response 已有此欄位（DB schema 已定義）。用 `useMemo` 按 `dispute_id` 分組 damages 並傳入對應的 DisputeCard。

### 4. DamagesTab 的去留

**決定**：移除獨立的 `DamagesTab` view。金額 CRUD 邏輯（`DamageFormDialog`、`handleAdd/Edit/Delete`）提取為 hook 或直接在 DisputesTab 層級管理，傳入 DisputeCard。

### 5. useUIStore 清理

**決定**：移除 `analysisSubTab` 狀態和 `setAnalysisSubTab` action（不再有 sub-tab）。`sidebarTab` type 從 `'case-info' | 'case-materials' | 'analysis'` 改為 `'case-info' | 'disputes' | 'case-materials'`。

## Risks / Trade-offs

- **爭點卡片展開後偏長** → 用 inline 排版壓縮金額區塊高度（一行一個項目，不用完整 card）
- **未分類金額可能被忽略** → 底部摺疊區塊加 badge 顯示數量和金額提醒
- **DamageFormDialog 依賴 dispute_id** → 從爭點卡片內新增時自動帶入 dispute_id；從未分類區新增時 dispute_id = null
