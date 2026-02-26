# LexDraft — Backlog

> 依優先級排序。每個群組內的項目可獨立開發。

## A. 編輯器 & AI 書寫體驗

- [ ] 引用審查模式（Citation review modal）：點擊引用標籤展開完整引用內容，可確認/拒絕/修改
- [ ] 檔案展開後的「插入引用」「查看全文」按鈕

## B. 資料連動 & 分析

- [ ] 金額與書狀雙向同步：互動式金額表格，修改金額自動連動訴之聲明段落
- [ ] 爭點可點擊跳轉到對應書狀段落（手動或自動標記）
- [ ] 時間軸獨立放置（待確定形式：獨立 tab 或其他）
- [ ] 版本比對模式：左右雙欄 diff view，語意層級段落比對

## C. Agent 架構 & 自動化

- [ ] AI 一鍵初始化：上傳檔案後 AI 自動分析產生爭點/時間軸/當事人
- [ ] 用戶自定義指令：律師可建立常用 prompt 指令集

## D. Pipeline v4 第二期

- [ ] 判例搜尋（search_precedent）：Step 2 tool-loop 架構天然支持新增工具，後續只需加一個工具定義 + MongoDB/向量資料庫
- [ ] 律師手動調整推理：前端「調整推理」按鈕，讓律師能修改 claims 或 legal_reasoning 後重新生成書狀
- [ ] legal_reasoning 結構化：觀察第一版內容後，考慮拆出 `elements`、`proof_plan`、`excluded_bases` 等結構化欄位
- [ ] 混合模型策略：tool-loop 推理輪用 Flash、finalize 用 Sonnet 的精細化模型切換
- [ ] 相鄰條群規則表（adjacentLawRules.ts）：規則驅動的關聯法條帶出（如查到 184 → 自動帶出 185、186）
- [ ] 案型速查表（supplementByBriefType）：按書狀類型硬編碼必搜法條（如交通事故 → 184、191-2、193 等）

## E. 文件管理

- [ ] 模板系統：預設書狀模板（民事起訴狀、準備書狀、上訴狀等）
- [ ] 全文搜尋：搜尋 PDF、書狀草稿、法條等所有內容

## F. 匯出

- [ ] Word 匯出（`POST /api/briefs/:id/export/docx`）
  - [ ] 安裝 docx（docx-js）
  - [ ] Word 格式：A4、邊距 2.54/3.17cm、標楷體/新細明體、12pt 內文、1.8 倍行距
  - [ ] 引用轉換：inline badge → 括號引用文字（如「（原證一，事故分析研判表）」）
  - [ ] content_structured → docx 段落映射（section/subsection 對應 heading 層級）
  - [ ] 前端：Header「下載 Word」按鈕
- [ ] PDF 匯出（`POST /api/briefs/:id/export/pdf`，嵌入 Noto Serif TC 字體）

## G. 系統 & 權限

- [ ] 完整認證系統（email/password + PBKDF2 via Web Crypto API，register/login/logout）
- [ ] 多用戶 / 團隊協作（RBAC、案件權限控管）
- [ ] 月度 token budget 上限 + 告警

## H. 待討論

- [ ] Smart Chips（智慧標籤）：自動識別人名、時間、金額，點擊可跳轉時間軸事件或確認矛盾
- [ ] 書狀格式強化：行距/段距調整、段落編號的可視化（更接近法院書狀格式）

---

## 健壯性提升（Robustness）

### Zod 驗證層

- [ ] 安裝 zod + @hono/zod-validator
- [ ] 為所有 API route 的 request body 加入 Zod schema 驗證
  - [ ] `POST /api/cases` — title required, case_number optional string
  - [ ] `PUT /api/cases/:id` — partial case fields
  - [ ] `PUT /api/files/:id` — category enum, doc_type enum, doc_date optional
  - [ ] `PUT /api/briefs/:id` — title string, content_structured object
  - [ ] `POST /api/law/search` — query required string, limit optional number
- [ ] Agent tool arguments 加入 runtime Zod 驗證（替代目前的 `as string` 強制型別轉換）
- [ ] 統一錯誤回傳格式：`{ error: string, details?: ZodError['issues'] }`

### 錯誤處理統一

- [ ] 建立 `src/server/lib/errors.ts`：AppError class（statusCode + message + code）
- [ ] Hono global error handler：捕獲 AppError → 回傳結構化錯誤 JSON
- [ ] Agent tool 執行錯誤：統一用 toolError helper，加入 error code 分類
- [ ] AI API 呼叫：加入 retry with exponential backoff（最多 3 次）
- [ ] Queue Consumer：失敗時寫回 D1（status: error + error_message），支援手動重試

### 前端錯誤處理 & 通知

- [ ] API 錯誤自動 toast（檔案上傳失敗、書狀儲存失敗、法條搜尋失敗等）
- [ ] 成功操作 toast（書狀已儲存、檔案已刪除等）
- [ ] SSE 連線中斷 toast + 自動重連提示
- [ ] Agent loop 異常中斷：前端顯示錯誤訊息、允許重新發送指令
- [ ] PDF 文字提取失敗：前端顯示「無法提取文字，請確認 PDF 非純圖片掃描檔」
- [ ] 檔案上傳失敗：R2 寫入失敗回滾 D1 記錄、前端顯示具體錯誤原因
- [ ] Token / 成本超限：接近上限時 Status Bar 警告、超限時阻止新的 Agent 請求

### 配置清理

- [ ] 將 AI model name、max rounds、file size limits 等硬編碼值抽到共用 config
- [ ] 統一 AI prompt templates 到 `src/server/agent/prompts/`
- [ ] 移除開發用 console.error，改為結構化 logging

---

## UI 細節

### 快捷鍵（暫緩）

- [ ] `Cmd+B` — 切換右側 sidebar 展開/收合
- [ ] `Cmd+J` — 展開左側 Chat + focus 輸入框
- [ ] `Cmd+1` — 切換到案件資料 tab
- [ ] `Cmd+2` — 切換到分析 tab

### 響應式 & Edge Cases

- [ ] 窄螢幕（< 1280px）：右側 sidebar 預設收合，只顯示 icon bar；左側 Chat 預設收合
- [ ] 寬螢幕（≥ 1920px）：右側 sidebar 預設寬度加大到 480px
- [ ] 確認 sidebar resize handle 與 editor panel resize handle 不衝突
- [ ] 確認檔案上傳（drag-drop）在新佈局中正常運作
- [ ] 確認 OutlinePanel / VersionPanel 浮動 overlay 在新佈局中位置正確
