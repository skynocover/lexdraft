## Context

CaseInfoTab 目前為扁平表單（`CaseInfoTab.tsx`, 372 行），所有欄位平鋪。法院用原生 `<select>`，案號與法院擠在 `grid-cols-2`。缺少庭別欄位，導致 templateRenderer 無法產出完整法院標題。

現行資料流：`CaseInfoTab → useCaseStore.updateCase → PATCH /api/cases/:id → cases table`。templateRenderer 從 `CaseDataForRender.court` 取法院名，但沒有庭別資訊。

## Goals / Non-Goals

**Goals:**
- CaseInfoTab 分為 3 組（案件資訊 / 當事人 / AI 設定），提升可讀性
- 新增庭別 dropdown（DIVISIONS 常數），預設民事庭
- 法院改用 shadcn Select（與範本選擇器統一風格）
- 法院 + 庭別同一行，案號獨立一行
- templateRenderer 組合 court + division 產出完整法院標題
- DB cases 表新增 division 欄位

**Non-Goals:**
- 不改 NewCaseDialog（保持簡潔，只有標題 + 立場）
- 不改書狀內容產生邏輯（pipeline steps）
- 不做法院錯誤的紅字標記（改為讓使用者更容易填正確值）
- 不做庭別自動推斷

## Decisions

### 1. 庭別選項清單

使用固定 5 選項：`民事庭`、`刑事庭`、`簡易庭`、`家事庭`、`行政訴訟庭`。

理由：臺灣法院庭別有限且穩定，不需要像法院那樣有 39 個選項。絕大多數律師書狀是民事或刑事。預設「民事庭」因為這是最常見的使用情境。

### 2. 分組方式：section header + spacing

用 `<h3>` 小標題 + spacing 分隔三組，不使用 accordion 或 tabs。

理由：所有欄位都應該一眼可見，不需要展開/收合。sidebar 空間有限，tabs 增加認知負擔。簡單的 header + gap 最有效。

### 3. 法院 dropdown 改用 shadcn Select

目前法院是原生 `<select>`，範本已用 shadcn `<Select>`。統一為 shadcn Select。

### 4. templateRenderer 整合方式

在 `CaseDataForRender` interface 加 `division` 欄位，`buildCaseDataBlock` 將 division 加入案件資料塊。Flash Lite 負責組合（如「臺灣臺北地方法院　民事庭　公鑒」）。

不做程式化組合，因為法院格式在不同範本中可能不同（有些用全稱、有些省略），交給 Flash Lite 根據範本 context 填入更靈活。

### 5. DB migration

新增 `division TEXT` 欄位到 cases 表，nullable，無預設值。API PATCH 支援 division 欄位。

## Risks / Trade-offs

- [Flash Lite 組合格式不穩定] → 可接受，因為法院 + 庭別是明確字串，Flash Lite 只是做字串替換
- [庭別選項不夠完整] → 5 選項涵蓋 99% 使用情境，未來可擴充
- [既有案件 division 為 null] → templateRenderer 已處理 null 情況（輸出「（無）」），Flash Lite 會保留佔位符
