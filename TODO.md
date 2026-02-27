# LexDraft — 開發計劃

> 依 ROI（影響力 / 開發成本）排序。核心目標：讓律師用 vibe coding 方式寫書狀。

---

## Tier S — 極高 ROI（低成本、高感知）

> 做一天就能讓產品明顯變好的項目

- [ ] **S1. 案型速查表**（`supplementByBriefType`）
  - 按書狀類型硬編碼必搜法條（如交通事故 → 184、191-2、193、196 等）
  - 一張 mapping table，確保常見案型的關鍵法條不漏，直接提升書狀品質
- [ ] **S2. 相鄰條群規則表**（`adjacentLawRules.ts`）
  - 規則驅動的關聯法條帶出（如查到 184 → 自動帶出 185、186、191-2）
  - 一張規則表，法條覆蓋率大幅提升
- [ ] **S3. AI 一鍵初始化**
  - 上傳檔案後 AI 自動分析產生爭點/時間軸/當事人/金額
  - 現有 tool 串起來即可，目前用戶要手動請 AI 分析，自動化後整個流程變順
- [ ] **S4. 前端錯誤 toast 通知**
  - 安裝 sonner，在 API 層統一攔截
  - API 錯誤自動 toast（上傳失敗、儲存失敗、搜尋失敗等）
  - 成功操作 toast（書狀已儲存、檔案已刪除等）
  - SSE 連線中斷 toast + 自動重連提示
  - Agent loop 異常中斷：顯示錯誤訊息、允許重新發送
  - PDF 文字提取失敗：顯示「無法提取文字，請確認 PDF 非純圖片掃描檔」

---

## Tier A — 高 ROI（中等成本、核心體驗）

> 直接影響「律師信不信任 AI 產出」的功能

- [ ] **A1. Word 匯出精修**
  - 引用轉換：inline badge → 括號引用文字（如「（原證一，事故分析研判表）」）
  - content_structured → docx 段落映射（section/subsection 對應 heading 層級）
  - Word 格式：A4、邊距 2.54/3.17cm、標楷體/新細明體、12pt 內文、1.8 倍行距
  - 律師最終要交給法院的是 Word，格式對了產品才算「可用」
- [ ] **A2. 引用審查完善**
  - 點擊 citation badge → 展開完整引文內容，可確認/拒絕/修改
  - 檔案展開後的「插入引用」「查看全文」按鈕
  - AI 書狀的信任基礎，律師需要確認每個引用來源
- [ ] **A3. 爭點↔書狀段落跳轉**
  - 右側爭點卡片點擊 → 跳到書狀對應段落（手動或自動標記）
  - 幫律師快速 review AI 有沒有漏掉爭點
- [ ] **A4. 律師手動調整推理**
  - 前端「調整推理」按鈕，讓律師能修改 claims 或 legal_reasoning 後重新生成書狀
  - 從「全自動」變成「人機協作」，vibe coding 的核心體驗

---

## Tier B — 中 ROI（中等成本、錦上添花）

> 讓產品更完整，但不做也不影響核心流程

- [ ] **B1. 模板系統**
  - 預設書狀模板（民事起訴狀、準備書狀、上訴狀等）
  - 新用戶可以直接選模板開始，降低上手門檻
- [ ] **B2. 金額↔書狀雙向同步**
  - 互動式金額表格，修改金額自動連動訴之聲明段落
  - 實作複雜（需追蹤段落內金額位置），但對損害賠償類案件很有價值
- [ ] **B3. 版本比對 diff view**
  - 左右雙欄語意層級段落比對
  - AI 每次改稿後能看差異，補上版本歷史的最後一哩
- [ ] **B4. 判例搜尋 tool**（`search_precedent`）
  - Step 2 tool-loop 架構天然支持新增工具
  - 需要新 DB/向量搜尋基礎建設，對品質影響大但建設成本高

---

## Tier C — 低 ROI（高成本 或 非核心）

> 穩定性基礎建設，上線前需要但不影響產品價值感知

- [ ] **C1. Zod 驗證層**
  - 安裝 zod + @hono/zod-validator
  - 為所有 API route 的 request body 加入 Zod schema 驗證
    - `POST /api/cases` — title required, case_number optional string
    - `PUT /api/cases/:id` — partial case fields
    - `PUT /api/files/:id` — category enum, doc_type enum, doc_date optional
    - `PUT /api/briefs/:id` — title string, content_structured object
    - `POST /api/law/search` — query required string, limit optional number
  - Agent tool arguments 加入 runtime Zod 驗證（替代目前的 `as string` 強制型別轉換）
  - 統一錯誤回傳格式：`{ error: string, details?: ZodError['issues'] }`
- [ ] **C2. 統一錯誤處理**
  - 建立 `src/server/lib/errors.ts`：AppError class（statusCode + message + code）
  - Hono global error handler：捕獲 AppError → 回傳結構化錯誤 JSON
  - Agent tool 執行錯誤：統一用 toolError helper，加入 error code 分類
  - AI API 呼叫：加入 retry with exponential backoff（最多 3 次）
  - Queue Consumer：失敗時寫回 D1（status: error + error_message），支援手動重試
- [ ] **C3. PDF 匯出**
  - `POST /api/briefs/:id/export/pdf`，嵌入 Noto Serif TC 字體
  - 台灣法院收 Word 為主，PDF 需求較低
- [ ] **C4. 配置清理**
  - 將 AI model name、max rounds、file size limits 等硬編碼值抽到共用 config
  - 統一 AI prompt templates 到 `src/server/agent/prompts/`
  - 移除開發用 console.error，改為結構化 logging
- [ ] **C5. 響應式佈局**
  - 窄螢幕（< 1280px）：右側 sidebar 預設收合，只顯示 icon bar；左側 Chat 預設收合
  - 寬螢幕（≥ 1920px）：右側 sidebar 預設寬度加大到 480px
  - 確認 sidebar resize handle 與 editor panel resize handle 不衝突
  - 確認檔案上傳（drag-drop）在新佈局中正常運作
  - 確認 OutlinePanel / VersionPanel 浮動 overlay 在新佈局中位置正確
- [ ] **C6. 快捷鍵**
  - `Cmd+B` — 切換右側 sidebar 展開/收合
  - `Cmd+J` — 展開左側 Chat + focus 輸入框
  - `Cmd+1` — 切換到案件資料 tab
  - `Cmd+2` — 切換到分析 tab

---

## Tier D — 商業化前置（有 traction 後再做）

> 需要用戶驗證後才值得投入

- [ ] **D1. Email/password 認證**
  - PBKDF2 via Web Crypto API，register/login/logout
  - 上線必須，但對核心體驗無加分
- [ ] **D2. 額度 & 收費系統**
  - 只收「產生書狀」，其餘操作全部免費
  - 收費模式：
    | 動作 | 收費 | 理由 |
    |------|------|------|
    | 對話問答 | 免費 | Gemini Flash 成本極低，是轉換漏斗入口 |
    | 上傳檔案 | 免費 | 降低使用門檻 |
    | 分析爭點/損害/時間軸 | 免費 | 分析是前置作業 |
    | 搜尋法條 | 免費 | 成本低 |
    | **產生書狀** | **扣 1 次額度** | 唯一有明確價值的產出 |
    | 修改書狀 | 免費 | Gemini Flash，售後服務 |
  - 免費用戶限制：
    | 項目 | 免費版 | 專業版（價格待定） |
    |------|--------|-----------------|
    | 對話 | 20 則/天 | 無限 |
    | 書狀 | 3 份/月 | 30 份/月 |
    | 檔案 | 5 個/案件 | 無限 |
  - 產生書狀流程（確認卡片機制）：
    1. 用戶在 chatbot 說「幫我寫起訴狀」
    2. AI 理解意圖，準備呼叫 `create_brief`
    3. 不直接執行，改為回傳確認卡片（SSE event: `brief_confirm`）
    4. 前端顯示確認卡片：書狀類型、消耗額度、剩餘額度、確認/取消按鈕
    5. 用戶按「確認產生」→ 前端發 API → 執行 pipeline → 扣額度
    6. 額度不足時：顯示「額度已用完」+ 升級方案按鈕
  - 技術實作：
    - [ ] DB：用戶額度表（user_quotas），記錄月份、已用書狀數、書狀上限、每日對話數
    - [ ] 後端：`create_brief` tool 執行前檢查額度，回傳 `brief_confirm` SSE event
    - [ ] 後端：確認 API endpoint（`POST /api/briefs/confirm`），驗證額度後執行 pipeline 並扣額度
    - [ ] 後端：對話限制 middleware，計算當日對話數，超限回傳 429
    - [ ] 前端：確認卡片元件（BriefConfirmCard），顯示書狀類型、剩餘額度、確認/取消
    - [ ] 前端：額度不足卡片，導向付費頁面
    - [ ] 前端：某處顯示當前剩餘書狀額度（header 或 sidebar）
    - [ ] 每月自動重置免費額度（cron 或按月份判斷）
- [ ] **D3. 多用戶 / RBAC**
  - 團隊協作、案件權限控管
  - 早期不需要，團隊版功能

---

## 暫緩（ROI 不明確，視實際使用數據再決定）

| 項目 | 暫緩理由 |
|------|----------|
| Smart Chips（自動識別人名/時間/金額） | 酷但非必要，律師不一定需要 |
| 書狀格式強化（行距/段距/段落編號） | 待觀察律師對格式的實際需求 |
| 全文搜尋（跨 PDF/書狀/法條） | 案件檔案不多時用不到 |
| 混合模型策略（Flash + Sonnet 切換） | 優化成本用，早期流量低不急 |
| `legal_reasoning` 結構化 | 需要更多實際使用數據再決定 schema |
| 用戶自定義指令集 | 需先觀察律師常用 prompt 模式 |
| 時間軸獨立 tab | 形式待定 |
