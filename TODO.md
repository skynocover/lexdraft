# LexDraft — Scrum 開發計畫

> 每個 Sprint 交付一個可測試的增量。前一個 Sprint 完成後才進入下一個。
> 每個 Sprint 結束時進行驗收，確認功能正常再繼續。

---

## Sprint 0 — 專案基礎建設

> 目標：建立可運行的前後端框架，所有後續開發的地基。
> 認證先用環境變數 token 簡化處理，MVP 為單人工具，完整 email/password 認證移至 Backlog。

- [x] 安裝前端依賴（React、React DOM、React Router）
- [x] 安裝 Tailwind CSS v4 + shadcn/ui，配置深色主題色彩系統（參考 TASKS.md §9）
- [x] 安裝 Zustand，建立四個 domain store 骨架（useCase / useBrief / useChat / useUI）
- [x] 安裝 Drizzle ORM + drizzle-kit，定義完整 D1 schema（users / cases / files / briefs / disputes / law_refs / messages）
- [x] 執行 migration 產生 SQL，確認 D1 表建立成功
- [x] 配置 wrangler.jsonc 綁定（D1 / R2 / Queue / Durable Objects）
- [x] Hono 後端建立路由分層結構（server/routes/cases.ts, files.ts, chat.ts, briefs.ts）
- [x] 前端 entry point 改為 React（App.tsx），Vite 配置 client/server 分離
- [x] 簡易認證：環境變數 token（`AUTH_TOKEN`），auth middleware 驗證 Bearer token
- [x] 前端：簡單 token 輸入頁，localStorage 存 token，未驗證導向輸入頁
- [x] 驗收：輸入正確 token → 看到空白 React App → API 未帶 token 回 401

---

## Sprint 1 — 三欄佈局 + 案件管理 + 編輯器骨架

> 目標：完成 UI 骨架，可建立/瀏覽案件，編輯器用 mock 資料先跑起來。
> Tiptap 編輯器骨架提前建立，降低 Sprint 4 的風險（Sprint 4 專注 Agent + Citations 整合）。

- [x] 實作三欄佈局組件（Chat 320px / Editor flex:1 / Sidebar 240px）
- [x] 實作 Header（48px）：Logo、案件名稱、書狀類型下拉選單、下載按鈕（placeholder）
- [x] 實作 Status Bar（26px）：Model 名稱、Token 用量、費用顯示（placeholder）
- [x] 套用完整深色主題 CSS variables（--bg-0 ~ --bg-h, --bd, --t1~t3, 功能色）
- [x] 後端 API：`POST /api/cases`、`GET /api/cases/:id`、`PUT /api/cases/:id`
- [x] 前端：案件建立表單（title, case_number, court, case_type, plaintiff, defendant）
- [x] 前端：案件列表頁 / 案件詳情頁（React Router）
- [x] useCaseStore 整合 API，管理案件狀態
- [x] 安裝 Tiptap 相關套件
- [x] 編輯器可抽換架構：`components/editor/index.ts` re-export、`types.ts` 合約、`tiptap/` 實作
- [x] Tiptap 基礎渲染：用 mock content_structured 資料渲染格式化書狀（serif 字體、段落結構）
- [x] 書狀 header：案號、原告、被告（mock 資料）
- [x] 段落用 `data-p` 和 `data-dispute` attribute 標識
- [x] useBriefStore 骨架：管理書狀內容狀態
- [x] 驗收：可建立案件 → 進入案件頁面看到三欄佈局 → 中欄編輯器用 mock 資料渲染書狀 → 深色主題正確套用

---

## Sprint 2 — 檔案上傳 + AI 分類 + 右側卷宗面板

> 目標：律師可上傳 PDF，系統自動提取文字、AI 分類、生成摘要，右側面板顯示完整分類結果。
> 合併檔案上傳與 AI 處理，一次交付「上傳 → 分類 → 摘要」完整流程。

- [x] 安裝 unpdf（或 pdf-parse + nodejs_compat_v2）
- [x] 後端 API：`POST /api/cases/:id/files`（multipart upload → R2 存儲 + D1 寫 pending → Queue message）
- [x] 後端 API：`GET /api/cases/:id/files`（列出檔案）
- [x] 後端 API：`GET /api/cases/:id/files/status`（polling 用，回傳各檔處理進度）
- [x] 後端 API：`PUT /api/files/:id`（手動修改分類）
- [x] 後端 API：`DELETE /api/files/:id`（刪除檔案）
- [x] 後端 API：`GET /api/files/:id/content`（取得全文）
- [x] 實作 Queue Consumer：接收 file message → PDF 文字提取 → 存 full_text 到 D1
- [x] 整合 Cloudflare AI Gateway：呼叫 Haiku 做文件分類 + 摘要生成
- [x] 分類邏輯：根據檔名 + 內容判斷 category（ours/theirs/court/evidence）和 doc_type
- [x] 摘要格式：結構化 JSON（type, party, summary, key_claims, key_dates, key_amounts, contradictions）
- [x] 前端：檔案上傳驗證（PDF only, 20MB limit, max 30 files per case）
- [x] 前端：檔案處理進度顯示（「3/12 已處理」進度條）
- [x] 右側面板 — 案件卷宗區塊（可收合）
  - [x] 四個分類群組：我方書狀(藍) / 對方書狀(橙) / 法院文件(青) / 證據資料(綠)
  - [x] 每個群組可獨立收合
  - [x] 檔案項目：PDF icon + 檔名 + 日期 + 處理狀態（pending/ready/error）
  - [x] 檔案展開顯示 AI 摘要，對方文件標註為「AI 重點」
  - [x] 底部上傳入口（虛線區域，「+ 上傳（自動分類）」）
- [x] useCaseStore 整合檔案列表管理
- [x] 驗收：上傳多個 PDF → 自動分類到正確群組 → 展開可看摘要 → 律師可手動調整分類

---

## Sprint 3 — 聊天面板 + Agent 核心

> 目標：律師可透過聊天與 AI 對話，AI 能執行基礎工具（讀取文件列表、讀取文件內容）。

- [x] 實作 Durable Objects：AgentDO（管理 Agent loop 生命週期）
- [x] 實作 Agent loop 核心：接收指令 → Gemini 2.5 Flash tool use → 執行 tool → 回傳結果 → 迴圈
- [x] 實作 Agent tools：`list_files`、`read_file`
- [x] 後端 API：`POST /api/cases/:id/chat`（SSE streaming）
- [x] 後端 API：`POST /api/cases/:id/chat/cancel`（取消進行中的 loop）
- [x] 後端 API：`GET /api/cases/:id/messages`（歷史記錄）
- [x] 後端 API：`DELETE /api/cases/:id/messages`（清除對話）
- [x] Agent 成本控制：最大 15 輪、token 用量回傳
- [x] 前端 — 聊天面板 UI
  - [x] 用戶訊息 / AI 訊息 渲染（Markdown 渲染）
  - [x] Tool Call 卡片（可展開收合，顯示 tool name + 結構化結果 + 勾勾）
  - [x] 進度條（嵌入對話流）
  - [x] SSE 接收 + streaming 文字顯示
  - [x] 底部輸入框 + 送出按鈕 + 停止按鈕
  - [x] 清除對話按鈕
- [x] useChatStore：管理訊息列表、streaming 狀態
- [x] messages 表持久化：關閉瀏覽器後重開能看到歷史對話
- [x] Status Bar 即時更新：Model 名稱 + token 用量 + 估算成本（NT$）+ streaming 狀態
- [x] 驗收：輸入「分析案件卷宗」→ AI 呼叫 list_files → 讀取相關文件 → 回應分析結果 → Tool Call 卡片正確顯示

---

## Sprint 4 — 書狀撰寫 + 引用系統 + Tab 系統

> 目標：核心價值交付。AI 可撰寫書狀草稿，引用標籤可互動，書狀即時顯示在編輯器。
> Tiptap 骨架已在 Sprint 1 建立，此處專注 Agent tools + Citations API 整合。
> 加入 Tab 系統，讓使用者可以在主區域切換書狀與 PDF 檔案。

- [x] 實作 Agent tool：`write_brief_section`（撰寫/重寫段落）
- [x] 實作 Agent tool：`analyze_disputes`（分析爭點）
- [x] 後端 API：`GET /api/cases/:id/briefs`、`GET /api/briefs/:id`、`PUT /api/briefs/:id`
- [x] 後端 API：`GET /api/cases/:id/disputes`
- [x] briefs 表：content_structured 為唯一 source of truth
- [x] 引用標籤渲染：證據引用（藍底 badge）、法條引用（紫底 badge）、待確認引用（黃色虛線）
- [x] 引用 hover 浮動卡片（來源文件 + 被引用原文）
- [x] 工具列：預覽/編輯 toggle（編輯模式暫 disabled）、引用統計（「6 確認 · 3 待確認 →」）
- [x] SSE brief_update event：AI 寫完段落即時推送到編輯器
- [x] useBriefStore 完整整合：引用狀態、爭點資料
- [x] 右側面板：反駁目標文件黃色字體 + 星號標記（撰寫時才知道目標）
- [x] Tab 系統：useTabStore 狀態管理、TabBar 元件、書狀/檔案 tab 切換
- [x] PDF 檔案檢視器：react-pdf 渲染（CMap 支援 CJK）、從 R2 串流原始 PDF
- [x] 右側面板改進：書狀草稿區塊（含刪除功能）、可折疊區段、點擊檔案開 tab
- [x] Header 簡化：移除書狀下拉選單（改由 Tab 切換）
- [x] SSE create_brief 自動開新 tab
- [x] Tiptap custom extensions：citation node、paragraph-block node
- [ ] Claude Citations API 整合：document content blocks + citations.enabled
- [x] 驗收：輸入「撰寫民事準備二狀」→ AI 分析卷宗 → 生成帶引用的書狀 → 編輯器即時顯示 → 引用可 hover 查看原文

---

## Sprint 5 — 編輯器增強

> 目標：律師可精細編輯書狀，逐段請 AI 重寫，並審查所有引用。
> Tiptap 架構已在 Sprint 4 建立，此處只需解鎖編輯模式並加入互動功能。

- [x] 啟用 Tiptap 編輯模式（所見即所得）— 改為 A4PageEditor，使用真正的 Tiptap useEditor()
- [x] 預覽/編輯模式切換 — 移除雙模式，改為永遠可編輯（類似 Word）
- [x] 段落浮動工具列（hover 時右上角顯示）— 已在先前 Sprint 實作
  - [x] AI 重寫 → 填入聊天指令
  - [x] 加強論述 → 填入聊天指令
  - [x] 插入引用 → 填入聊天指令
  - [x] 刪除段落 → 標記刪除線 + 確認
- [x] 引用審查模式
  - [x] 工具列「待確認」按鈕 → 打開 modal overlay
  - [x] 審查卡片：來源原文 vs 書狀引用
  - [x] 按鈕：確認正確 / 移除引用 / 跳過
  - [x] 書狀中對應引用閃爍高亮
  - [x] 自動跳到下一個待確認引用
- [x] 驗收：永遠可編輯 → hover 段落出現工具列 → 點「AI 重寫」指令進入聊天 → 引用審查流程完整可用

---

## Sprint 6 — 底部案件分析面板（核心 Tabs）

> 目標：提供最重要的案件分析視圖，輔助律師撰寫策略。
> 先交付爭點和金額兩個高價值 Tab，其餘 Tab 移至 Sprint 7。

- [x] 底部面板通用機制：toggle bar 收合/展開、Tab 切換、可拖拉高度（resize handle, 100px ~ 500px）
- [x] 實作 Agent tool：`calculate_damages`
- [x] 後端 API：`GET /api/cases/:id/damages`
- [x] Tab 1 — 爭點分析
  - [x] 可展開收合的爭點卡片（編號 + 標題）
  - [x] 展開：我方主張、對方主張、證據、法條
  - [x] 「跳到段落」連結按鈕
- [x] Tab 2 — 金額計算
  - [x] 按類別的金額卡片（貨款、利息等）
  - [x] 每張小計 + 展開明細
  - [x] 底部請求總額 highlight bar
- [x] 驗收：底部面板可收合展開 → 可拖拉高度 → 爭點卡片可展開 → 金額計算正確

---

## Sprint 7 — 剩餘分析 Tabs + 法條搜尋 + 進階互動

> 目標：補齊分析面板、串接法條 API、完善互動細節，交付完整產品。

- [x] 實作 Agent tool：`generate_timeline`
- [x] 後端 API：`GET /api/cases/:id/timeline`、`GET /api/cases/:id/parties`
- [x] Tab 3 — 時間軸
  - [x] 垂直 timeline（紅=關鍵 / 藍=一般 / 綠=當前）
  - [x] 每個事件：日期、標題、描述、來源文件
- [x] Tab 4 — 主張與舉證
  - [x] 表格：書狀主張 / 對應證據 / 狀態（ok / warn / miss）
- [x] Tab 5 — 當事人
  - [x] 原告/被告 兩張卡片（姓名、地址、代理人等）
- [x] 法條搜尋整合（需外部 API + Key 到位）
  - [x] 後端 API：`POST /api/law/search`
  - [x] 實作 Agent tool：`search_law`
  - [x] 右側面板法條區塊完整功能：badge + 條號 + 引用次數、展開全文 + 高亮、「插入引用」按鈕
  - [x] 底部搜尋輸入框
- [x] 爭點 ↔ 段落雙向連動
  - [x] 爭點 → 段落：點「跳到段落」→ 書狀中 `data-dispute="N"` 段落高亮 + 自動滾動
  - [x] 段落 → 爭點：雙擊段落 → 底部打開 + 切到爭點 tab + 高亮對應卡片
  - [x] 3 秒後自動取消高亮
- [ ] 驗收：五個 Tab 完整可用 → 法條可搜尋並引用 → 雙向連動順暢

---

## Sprint 8 — Word 匯出

> 目標：律師可將書狀下載為 Word 檔，直接送法院。

- [ ] 安裝 docx（docx-js）
- [ ] 後端 API：`POST /api/briefs/:id/export/docx`
- [ ] Word 格式：A4、邊距 2.54/3.17cm、標楷體/新細明體、12pt 內文、1.8 倍行距
- [ ] 引用轉換：inline badge → 括號引用文字（如「（原證一，事故分析研判表）」）
- [ ] content_structured → docx 段落映射（section/subsection 對應 heading 層級）
- [ ] 前端：Header「下載 Word」按鈕功能實作
- [ ] 驗收：點擊下載 → 取得格式正確的 .docx → Word 開啟排版正常 → 引用轉為括號文字

---

## 未來規劃（Backlog）

- [ ] 完整認證系統（email/password + PBKDF2 via Web Crypto API，register/login/logout）
- [ ] 版本比對模式（左右雙欄 diff view，語意層級段落比對）
- [ ] 動態快捷按鈕（Feature 4）：AI 根據書狀狀態動態生成建議按鈕
- [ ] 金額修改連動訴之聲明段落
- [x] 多版本書狀管理（版本紀錄面板、手動建立/預覽/還原/刪除版本）
- [ ] 多用戶 / 團隊協作（RBAC、案件權限控管）
- [ ] 月度 token budget 上限 + 告警
- [ ] PDF 匯出（`POST /api/briefs/:id/export/pdf`，嵌入 Noto Serif TC 字體）
- [ ] 重寫整段功能 看是不是要選取整段後 讓AI重寫 或是標記 或是選取後有輸入框 類似v0那樣的做法 段落級別的AI操作
- 類似claude code的revert功能
- 產生時間軸 獨立放置
- 金額如何跟書狀同步 (因為可能改到書狀 或是有其他更好的做法)
- ~~多版本控管~~ (已完成基礎版本紀錄功能)
- 用戶自行定義指令
- 把書狀跟證據都當成文件 可以查看 也可以關閉
- Smart Chips (智慧標籤) 自動識別的人名、時間、金額	將「113年10月5日」變成一個可點擊的 Chip，點擊後顯示當天的「時間軸事件」，確認有無矛盾。
- 全文搜尋功能 搜尋PDF 書狀草稿 法條等
- init功能
- 用書狀+卷宗的形式來規劃畫面會如何規劃
- 文書區加「行距/段距」與「段落編號」的可視化（更接近法院書狀）
- 爭點也變成可以點擊後跳轉過去 (用手動或是自動加上)
- 列出爭執跟非爭執事項
- 法條引用區該怎麼設計
- 金額計算同步 互動式表格等
- 模板系統


---

## 提醒：錯誤處理策略（全功能完成後統一補強）

> 各 Sprint 開發時先以 happy path 為主，功能全部到位後再統一補強錯誤處理。

- [ ] Queue Consumer 失敗重試：dead letter queue、max retries、失敗狀態寫回 D1（status: error + error_message）
- [ ] AI API 呼叫失敗：retry with exponential backoff、fallback 回應（「AI 暫時無法回應，請稍後再試」）
- [ ] Agent loop 異常中斷：DO 狀態清理、前端顯示錯誤訊息、允許律師重新發送指令
- [ ] D1 / R2 連接問題：graceful degradation、前端 toast 通知
- [ ] PDF 文字提取失敗：標記 status: error、前端顯示「無法提取文字，請確認 PDF 非純圖片掃描檔」
- [ ] SSE 連線中斷：前端自動重連、斷線期間訊息補回
- [ ] 檔案上傳失敗：R2 寫入失敗回滾 D1 記錄、前端顯示具體錯誤原因
- [ ] Token / 成本超限：接近上限時 Status Bar 警告、超限時阻止新的 Agent 請求

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

### 3.3 前端 Toast 通知

- [ ] 建立全域 Toast 系統（useToastStore 或輕量 context）
- [ ] API 錯誤自動 toast（檔案上傳失敗、書狀儲存失敗、法條搜尋失敗等）
- [ ] 成功操作 toast（書狀已儲存、檔案已刪除等）
- [ ] SSE 連線中斷 toast + 自動重連提示

### 3.4 配置清理

- [ ] 將 AI model name、max rounds、file size limits 等硬編碼值抽到共用 config
- [ ] 統一 AI prompt templates 到 `src/server/agent/prompts.ts`
- [ ] 移除開發用 console.error，改為結構化 logging


## Backlog

UI
- [x] 把左/右欄改成更淡的深灰層級，並降低邊框/陰影密度 讓畫面更接近大眾
- [x] 右下角顯示字數統計 類似word → 移至 AnalysisPanel tab 列右側
- [x] 書狀大綱預覽 → 改為浮動式收合目錄（OutlinePanel），覆蓋在編輯器上方
- [x] 把上傳檔案改到案件卷宗的右上角 點擊+的icon
- [x] 卷宗分類保留群組結構，統一顏色（不再用顏色區分），支援拖曳更換分類
- [x] PDF 縮放功能
- [x] 拖曳移動檔案功能 可以把卷宗自由拖曳到不同分類
- [x] 右側 sidebar 加寬（w-60 → w-72）減少編輯器留白