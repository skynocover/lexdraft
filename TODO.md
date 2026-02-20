# LexDraft — Scrum 開發計畫

## Backlog — 功能規劃

> 依優先級排序。每個群組內的項目可獨立開發。

### A. 編輯器 & AI 書寫體驗

- [x] 段落級 AI 操作：選取段落後顯示 inline 輸入框，可請 AI 重寫/加強/精簡（類似 v0 的互動方式）
- [x] 動態快捷按鈕：AI 根據書狀當前狀態動態生成建議操作按鈕
- [x] 對話 Rewind：AI 修改書狀後可在對話中一鍵退回該次修改（退回單次對話所做的所有變更，不同於版本紀錄）
- [x] 段落修改支援：write_brief_section 支援修改既有段落（自動匹配 section/subsection 或用 paragraph_id）

### B. 資料連動 & 分析

- [ ] 金額與書狀雙向同步：互動式金額表格，修改金額自動連動訴之聲明段落
- [ ] 爭點可點擊跳轉到對應書狀段落（手動或自動標記）
- [x] 列出爭執與非爭執事項
- [ ] 時間軸獨立放置（待確定形式：獨立 tab 或其他）
- [ ] 版本比對模式：左右雙欄 diff view，語意層級段落比對

### C. Agent 架構 & 自動化

- [ ] 案件 Onboarding + AI 一鍵初始化：引導流程（填寫資料 → 上傳檔案 → AI 分析產生爭點/時間軸/當事人）
- [x] Sub Agent 架構：write_full_brief pipeline（Planner + Writer sub-agents），一次工具呼叫完成整份書狀
- [x] Pipeline v3 Phase 1a：論證策略 Step + Writer Context 改善（ContextStore、Claim Graph、3層 Writer Context、策略驗證 + Retry）
- [x] Pipeline v3 Phase 1b：前端進度 UI 調整（ReviewContent、攻/防/參 badges、step children、策略 renderer）
- [x] Pipeline v3 Phase 2：法律研究 Agent（批次展開 + MongoDB 搜尋迴圈）
- [x] Pipeline v3 Phase 3a：Orchestrator Agent 取代 Step 1（案件分析、當事人、爭點、資訊缺口）
- [x] Pipeline v3 Phase 3b：事實爭議管理 + 完整 Claim Graph
- [x] Pipeline v3 Phase 4：品質審查（結構化前檢 + LLM 審查）
- [x] Pipeline 進度優化：隱藏舊進度條、法條搜尋顯示逐筆查詢進度（可展開看結果）、自動去除重複標題
- [x] 法條引用切換書狀時正確更新：改為僅依據當前書狀段落引用判斷已引用/備用
- [x] 法條搜尋優化：PCode 直接查表、別名解析（消保法→消費者保護法）、條號格式標準化、searchLawBatch 減少連線數
- [ ] 用戶自定義指令：律師可建立常用 prompt 指令集
- [ ] 法條查詢的方式 是否應該如果沒查到 就查別的資料 而不是由主要的agent 來決定 而是寫書狀的人決定 這樣由haiku查詢是好事嗎?

### D. 文件管理 & 模板

- [ ] 畫面重新規劃：以書狀 + 卷宗為核心重新設計佈局
- [ ] 模板系統：預設書狀模板（民事起訴狀、準備書狀、上訴狀等）
- [x] 法條引用區重新設計（is_manual 區分手動/AI、引用區=被引用、備用區=手動未引用、AI未引用自動清理）
- [ ] 全文搜尋：搜尋 PDF、書狀草稿、法條等所有內容

### E. 匯出

- [ ] Word 匯出（`POST /api/briefs/:id/export/docx`）
  - [ ] 安裝 docx（docx-js）
  - [ ] Word 格式：A4、邊距 2.54/3.17cm、標楷體/新細明體、12pt 內文、1.8 倍行距
  - [ ] 引用轉換：inline badge → 括號引用文字（如「（原證一，事故分析研判表）」）
  - [ ] content_structured → docx 段落映射（section/subsection 對應 heading 層級）
  - [ ] 前端：Header「下載 Word」按鈕
- [ ] PDF 匯出（`POST /api/briefs/:id/export/pdf`，嵌入 Noto Serif TC 字體）

### F. 系統 & 權限

- [ ] 完整認證系統（email/password + PBKDF2 via Web Crypto API，register/login/logout）
- [ ] 多用戶 / 團隊協作（RBAC、案件權限控管）
- [ ] 月度 token budget 上限 + 告警

### G. 待討論
- [ ] Smart Chips（智慧標籤）：自動識別人名、時間、金額，點擊可跳轉時間軸事件或確認矛盾
- [ ] 書狀格式強化：行距/段距調整、段落編號的可視化（更接近法院書狀格式）


---

### 已完成

- [x] 多版本書狀管理（版本紀錄面板、手動建立/預覽/還原/刪除版本）
- [x] 點擊引用後開啟檔案並 highlight
- [x] 收合左右側 sidebar
- [x] 把左/右欄改成更淡的深灰層級，降低邊框/陰影密度
- [x] 字數統計（移至 AnalysisPanel tab 列右側）
- [x] 書狀大綱預覽（浮動式收合目錄 OutlinePanel）
- [x] 上傳檔案改到案件卷宗右上角 + icon
- [x] 卷宗分類統一顏色 + 拖曳更換分類
- [x] PDF 縮放功能
- [x] 右側 sidebar 加寬（w-60 → w-72）

---

## Phase 3 — 健壯性提升（Robustness）

> 目標：提升系統穩定度與可維護性，統一錯誤處理、加入驗證層、改善使用者回饋。

### 3.1 Zod 驗證層

- [ ] 安裝 zod + @hono/zod-validator
- [ ] 為所有 API route 的 request body 加入 Zod schema 驗證
  - [ ] `POST /api/cases` — title required, case_number optional string
  - [ ] `PUT /api/cases/:id` — partial case fields
  - [ ] `PUT /api/files/:id` — category enum, doc_type enum, doc_date optional
  - [ ] `PUT /api/briefs/:id` — title string, content_structured object
  - [ ] `POST /api/law/search` — query required string, limit optional number
- [ ] Agent tool arguments 加入 runtime Zod 驗證（替代目前的 `as string` 強制型別轉換）
- [ ] 統一錯誤回傳格式：`{ error: string, details?: ZodError['issues'] }`

### 3.2 錯誤處理統一

- [ ] 建立 `src/server/lib/errors.ts`：AppError class（statusCode + message + code）
- [ ] Hono global error handler：捕獲 AppError → 回傳結構化錯誤 JSON
- [ ] Agent tool 執行錯誤：統一用 toolError helper，加入 error code 分類
- [ ] AI API 呼叫：加入 retry with exponential backoff（最多 3 次）
- [ ] Queue Consumer：失敗時寫回 D1（status: error + error_message），支援手動重試

### 3.3 前端錯誤處理 & 通知

- [ ] 建立全域 Toast 系統（useToastStore 或輕量 context）
- [ ] API 錯誤自動 toast（檔案上傳失敗、書狀儲存失敗、法條搜尋失敗等）
- [ ] 成功操作 toast（書狀已儲存、檔案已刪除等）
- [ ] SSE 連線中斷 toast + 自動重連提示
- [ ] Agent loop 異常中斷：前端顯示錯誤訊息、允許重新發送指令
- [ ] PDF 文字提取失敗：前端顯示「無法提取文字，請確認 PDF 非純圖片掃描檔」
- [ ] 檔案上傳失敗：R2 寫入失敗回滾 D1 記錄、前端顯示具體錯誤原因
- [ ] Token / 成本超限：接近上限時 Status Bar 警告、超限時阻止新的 Agent 請求

### 3.4 配置清理

- [ ] 將 AI model name、max rounds、file size limits 等硬編碼值抽到共用 config
- [ ] 統一 AI prompt templates 到 `src/server/agent/prompts.ts`
- [ ] 移除開發用 console.error，改為結構化 logging