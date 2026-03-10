# LexDraft — 開發計劃

> 依優先順序排列。核心目標：讓律師產出可直接送法院的書狀，只需 10-15 分鐘校閱。

---

## Phase 1 — 書狀可信度（必做）

> 解決「律師不敢直接用」的根本問題：格式要件缺失、事實幻覺

- [x] **P1-1. 訴之聲明段落生成** ✅
  - 法官收到書狀第一眼看的段落，目前完全缺失
  - Template 驅動：依 brief_type 決定訴之聲明格式
  - 從 damages 表自動組裝金額項目 + 總額
  - 含法定遲延利息（見 P1-4）、訴訟費用負擔、假執行聲請（「原告願供擔保，請准宣告假執行」）
  - 起訴狀：完整訴之聲明；準備書狀：引用原訴之聲明或重述
  - 實作：`templateRenderer.ts` + `defaultTemplates.ts`，pipeline 自動渲染模板 header/sections
- [x] **P1-2. 證物編號系統** ✅
  - `exhibits` 表（case-level），AI pipeline 自動分配甲證/乙證編號
  - 律師可在 ExhibitsTab 手動編輯、拖放排序、新增刪除
  - **正文內嵌引用**：Writer prompt 注入 exhibitMap，AI 自然寫出「有○○可稽（甲證一）」格式
  - **ExhibitMark**：正文中的證物編號渲染為藍色互動元素（hover 顯示引文、click 開檔）
  - **重排同步**：ExhibitsTab 拖放排序後，正文中的證物編號 swap-safe 自動更新
  - 隱性引用（AI 參考但未在正文標明的檔案）fallback 回 CitationNode badge
  - Word 匯出 + 證物清單複製到剪貼簿，零 token 成本
- [x] **P1-4. 法定遲延利息** ✅
  - 幾乎所有侵權訴訟都請求「自起訴狀繕本送達翌日起至清償日止按年息 5% 計算之利息」
  - 模板化固定文字，pipeline 自動插入訴之聲明段
  - 依案型決定起算日（侵權：起訴狀繕本送達翌日；契約：催告到達翌日等）
  - 實作：已納入 `defaultTemplates.ts` 模板文字，隨 P1-1 一併完成
- [ ] **P1-5. 書狀微調（prompt 層）**
  - ~~消除 meta 段落~~ ✅ 已不再出現空洞過渡句
  - 結論字數控制（目標 100-200 字，目前實際產出 349-435 字）
  - 物損折舊處理：brief_type + damage_category 觸發特定 prompt injection，主動論述折舊問題
- [x] **P1-6. 書狀首尾格式** ✅
  - 書狀首頁：法院名稱、案號、股別、案由、當事人欄（原告/被告姓名地址）
  - 書狀末尾：「謹狀」、受理法院名稱、具狀人簽名欄、具狀日期
  - 資料來源：`cases` 表已有 `court`、`case_number`、`plaintiff`、`defendant` 欄位
  - cases 表可能需新增欄位：`plaintiff_address`、`defendant_address`、~~`judge_division`（股別）~~ ✅ 已新增 `division`（庭別）欄位 + CaseInfoTab 下拉選單
  - Pipeline 產出時自動組裝，前端 editor 顯示為不可編輯的 header/footer 區塊
  - 實作：`templateRenderer.ts` 解析模板 header/footer，`briefPipeline.ts` 組裝為 paragraphs
- [x] **P1-7. Word 匯出** ✅
  - 律師交給法院的是 Word，沒這個功能產品不完整
  - 引用轉換：inline badge → 括號引用文字（如「（原證一，事故分析研判表）」）
  - content_structured → docx 段落映射（section/subsection 對應 heading 層級）
  - Word 格式：A4、邊距 2.54/3.17cm、標楷體/新細明體、12pt 內文、1.8 倍行距
  - 含訴之聲明、證物清單等結構化段落
  - 實作：`exportDocx.ts`（docx 產出 + 證物編號映射）、EditorToolbar「下載 Word」按鈕

---

## Phase 2 — 核心體驗

> 從「能用」到「好用」，建立律師信任與協作模式

- [ ] **P2-1. 引用審查 UX**
  - 點擊 citation badge → 展開完整引文內容，可確認/拒絕/修改
  - 檔案展開後的「插入引用」「查看全文」按鈕
  - AI 書狀的信任基礎，律師需要確認每個引用來源
- [ ] **P2-2. AI 一鍵初始化**
  - 上傳檔案後 AI 自動分析產生爭點/時間軸/當事人/金額
  - 現有 tool 串起來即可，目前用戶要手動請 AI 分析，自動化後整個流程變順
- [ ] **P2-3. 對造書狀攻防強化**
  - 現有基礎已可運作：`fileProcessor` 自動分類 `category: 'theirs'`，Step 2 reasoning 有完整 `ours/theirs` claims 攻防結構
  - 強化項：prompt 更明確強調「優先針對 theirs 文件中的主張進行逐一反駁」
  - 準備書狀場景：查詢本案已有書狀，注入前狀 context 供 AI 參考
  - 先實測品質再決定調整幅度
- [x] **P2-5. 案型法律知識庫** ✅
  - 按案型硬編碼常見法律議題及攻防要點，關鍵字計分偵測（MIN_SCORE=2）
  - 雙視角（原告/被告），依 clientRole 選擇注入 Step 2 reasoning prompt
  - 已完成案型：車禍、借貸、租賃、解僱/資遣、加班費/工資、職災
  - 待新增案型（依頻率排序）：不動產買賣（瑕疵擔保/解約/違約金）、一般侵權（名譽權/隱私權/網路誹謗）、離婚/家事（剩餘財產/贍養費/監護權）、承攬/工程（瑕疵修補/逾期罰款/追加工程款）、保證/連帶債務（先訴抗辯/時效）、醫療糾紛（因果舉證/醫療常規/鑑定）、退休金/資遣費計算、確認僱傭關係（假承攬/假委任）、調動爭議、競業禁止、性騷擾/職場霸凌、特休假/休假爭議
- [ ] **P2-6. 律師手動調整推理**
  - 前端「調整推理」按鈕，讓律師能修改 claims 或 legal_reasoning 後重新生成書狀
  - 從「全自動」變成「人機協作」，vibe coding 的核心體驗
  - ✅ 部分完成：爭點標題 inline edit + 爭點刪除（cascade delete 關聯 claims）— PATCH/DELETE `/api/cases/:caseId/disputes/:id`

---

## Phase 2.5 — 答辯狀相關延伸

> 答辯狀 pipeline 完成後的 UX 強化

- [ ] **P2.5-1. 多書狀工作空間**
  - 同一案件支援多份書狀（起訴狀 + 答辯狀 + 準備書狀）
  - Tab 切換方式，複用 `useTabStore`
  - `useBriefStore` 改為 `activeBriefId` + `briefs[]`
  - `briefContext` 送 active brief 的內容
  - 未來考慮並排檢視（split view），讓律師同時對照兩份書狀
- [ ] **P2.5-2. 書狀品質審查（Review Step）**
  - Pipeline Step 3 完成後自動跑品質審查，標記有風險的段落
  - Layer 1：純程式碼驗證（金額一致性、證物引用存在性、爭點覆蓋率、段落長度異常）
  - Layer 2：Gemini Flash 單次呼叫驗證（主張 vs 證據對應、法條 vs 論證一致、事實前後矛盾）
  - 前端段落標記（🔴 critical / ⚠️ warning），點擊展開問題描述
  - 只標記不自動修正，律師自己決定是否修改
  - 設計文件：`docs/design-review-step.md`

---

## Phase 3 — 差異化功能

> 讓產品從「能替代人工」變成「超越人工」

- [ ] **P3-1. 判例搜尋與引用**
  - 真正的書狀會引用判決字號（如「最高法院 108 年度台上字第 123 號判決參照」）
  - 需要新 DB/向量搜尋基礎建設，對品質影響大但建設成本高
  - Step 2 tool-loop 架構天然支持新增 `search_precedent` 工具
- [x] **P3-2. 爭點↔書狀段落跳轉** ✅
  - 右側爭點卡片點擊「跳至段落」→ 跳到書狀對應段落（DisputesTab `handleJumpToParagraph`）
  - 書狀段落雙擊 → 跳到對應爭點卡片（A4PageEditor `handleEditorDoubleClick`）
  - 實作：`LegalParagraph` extension 透過 `data-dispute-id` 屬性連結爭點與段落
- [ ] **P3-3. 版本比對 diff view**
  - 左右雙欄語意層級段落比對
  - AI 每次改稿後能看差異

---

## Phase 4 — 商業化前置

> 有 traction 後再做

- [ ] **P4-1. Email/password 認證**
  - PBKDF2 via Web Crypto API，register/login/logout
  - 上線必須，但對核心體驗無加分
- [ ] **P4-2. 額度 & 收費系統**
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
- [ ] **P4-3. 多用戶 / RBAC**
  - 團隊協作、案件權限控管
  - 早期不需要，團隊版功能

---

## 基礎建設（穿插進行）

> 不直接影響用戶但提升開發效率與穩定性

- [ ] **Infra-0. Pipeline 錯誤恢復（Phase 2 前完成）**
  - Pipeline 每完成一個 step，把中間結果存到 D1 或 Durable Object storage
  - 失敗時記錄 `failed_at_step` + `error_message`
  - 前端顯示「生成失敗，點擊重試」→ 從失敗的 step 重跑
  - 已有 `ContextStore` serialize/deserialize 基礎，實作成本不高
  - Phase 2 開始面向律師用戶，pipeline 失敗不能讓用戶束手無策
- [x] **Infra-1. Zod 驗證層** ✅
  - Zod v4 schemas in `src/server/schemas/`，所有 route + 10 tool 已遷移
  - `parseBody()` for routes, `safeParseToolArgs()` for tools (self-healing)
  - 統一錯誤回傳格式：`{ error: string, details?: ZodIssue[] }`
  - 刪除舊 `requireString` / `requireNumber` / `requireArray`
- [x] **Infra-2. 統一錯誤處理**（部分完成）
  - ~~AppError class + Hono global error handler~~ ✅ 原本就有
  - AI API 呼叫：retry with exponential backoff — 待 Infra-0 一併處理
  - Queue Consumer：失敗時寫回 D1 — 待補

---

## 降級 / 暫緩

| 項目                     | 原 Tier       | 降級理由                                                                                                               |
| ------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 案型速查表               | S1 → 基礎建設 | AI reasoning + 補搜機制已解決法條覆蓋率（本次 9 條法條、0/6 sections 缺法條），作為 safety net 仍有價值但 ROI 大幅下降 |
| 相鄰條群規則表           | S2 → 基礎建設 | 同上，Step 2 已能主動補搜相關法條（§213、§217）                                                                        |
| 金額↔書狀雙向同步        | B2 → 暫緩     | 實作複雜度極高，且 pipeline 已能從 damages 表正確帶入金額（5 項全部吻合）                                              |
| PDF 匯出                 | C3 → 暫緩     | 台灣法院收 Word 為主，A1 做完後需求極低                                                                                |
| 響應式佈局               | C5 → 暫緩     | 律師辦公環境幾乎都是大螢幕                                                                                             |
| 快捷鍵                   | C6 → 暫緩     | Polish 項目，不影響核心價值                                                                                            |
| 配置清理                 | C4 → 暫緩     | 工程衛生，視開發需要穿插進行                                                                                           |
| 書狀類型擴展（上訴狀等） | 暫緩          | 現有範本系統已涵蓋起訴狀/答辯狀/準備書狀的格式差異；上訴狀攻防結構不同（攻擊判決理由），等實際需求再加程式邏輯         |
| Smart Chips              | 暫緩          | 酷但非必要                                                                                                             |
| 全文搜尋                 | 暫緩          | 案件檔案不多時用不到                                                                                                   |
| 時間軸獨立 tab           | 暫緩          | 形式待定                                                                                                               |

---

## 書狀品質差距分析（2026-03-07 Pipeline 產出評估）

> 基於車禍案 pipeline 最新產出（law=20, file=48, total=68, 0-law=0/6），評估距離「律師直接使用」的差距。

### 致命硬傷

| 問題                      | 說明                                                                                                                       | 對應功能                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **沒有判決引用**          | 只引用法條，零判決。精神慰撫金、工作損失等主張缺類案判決佐證，法官不會只看法條                                             | P3-1 判例搜尋與引用                                                                |
| **管轄法院錯誤**          | Header 帶入錯誤法院（高雄 vs 臺北），會被退件                                                                              | P1-6 改進：根據案件事實自動判斷管轄法院（✅ 已新增庭別欄位，法院仍需用戶手動選擇） |
| ~~證物編號未內嵌正文~~ ✅ | ~~正文從未出現「（甲證X）」交叉引用~~ → 已實作 ExhibitMark 系統：prompt 注入 + 正文內嵌 + 互動高亮 + hover 引文 + 重排同步 | 已完成                                                                             |

### 思考深度不足

| 問題                   | 目前書狀                               | 律師期望                                                    |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------- |
| **反駁太淺**           | 「有證據支持，故合理」                 | 逐項拆解金額、引用判決說明認定標準                          |
| **未預防被告常見抗辯** | 完全沒處理折舊、健保給付、薪資計算基礎 | 主動論述折舊問題、區分健保/自費、說明薪資含獎金之合理性     |
| **請求權基礎不完整**   | 只用 §184(1) + §191-2                  | 應加 §184(2)（違反保護他人之法律 → 道交規則），舉證責任倒置 |
| **精神慰撫金論述弱**   | 「傷害程度重於輕傷」                   | 需列舉 3-5 個類案判決金額，說明本案情節相當                 |

### 功能優先級建議

| 優先級    | 功能                               | 影響                                  | 備註                                                              |
| --------- | ---------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| **P0**    | 判決資料庫搜尋 + 引用              | 沒有判決引用律師不會用                | 需整合司法院判決系統，Step 2 tool-loop 加 `search_precedent` 工具 |
| ~~P0~~ ✅ | ~~證物編號正文交叉引用~~           | ~~writer step 自動插入「（甲證X）」~~ | 已完成：ExhibitMark 系統                                          |
| **P1**    | 管轄法院自動判斷                   | 避免退件級錯誤                        | 根據事故地點/被告住所自動帶入正確法院                             |
| **P1**    | 律師指示 (case_instructions) 引導  | 目前 null，律師無法輸入策略偏好       | 前端引導填寫，注入 Step 2 prompt                                  |
| **P1**    | 對方常見抗辯預測 + 預防論述        | 折舊、健保、薪資基礎等                | 結合 P2-5 案型法律知識庫，注入 prompt                             |
| **P2**    | 律師審閱模式（逐段 accept/reject） | 從「全篇接受」到「段落微調」          | 前端 UX，不影響 pipeline                                          |
| **P2**    | 金額計算邏輯驗證                   | 自動檢查金額加總、利息起算日          | 可在 template renderer 做 validation                              |
| **P3**    | 多版本比較                         | 產出 2-3 版讓律師選策略方向           | 成本翻倍，優先級低                                                |

### 結論

書狀架構、論證邏輯、事實引用已達 70 分水準。**判決引用**和**證物編號正文交叉引用**是拉到 90 分的關鍵——補上後律師工作量從「重寫」降到「微調」。

---

## Phase 5 — 上線前置作業

> 產品上線前必須完成的工程與運維項目。依 **必做 / 強烈建議 / Nice-to-have** 分級。

### 🔴 必做（不做會出事）

- [ ] **L-1. 認證系統（取代 dev-token）**
  - 現況：單一 Bearer token `dev-token-change-me`，所有用戶共用 `DEFAULT_USER_ID = 'default-user'`
  - 目標：Email/password 登入（對應 P4-1），JWT + refresh token，多用戶隔離
  - 關聯：P4-2 額度系統也依賴真實 user_id
- [ ] **L-2. 環境變數安全化**
  - 現況：`.env` 未在 `.gitignore`，含真實 credentials（Cloudflare token、MongoDB 連線字串、API key）
  - 行動：
    - `.env` 和 `.dev.vars` 加入 `.gitignore`
    - 用 `wrangler secret put` 設定 production secrets
    - 輪替所有已暴露的 credentials
  - ⚠️ 如果 repo 曾公開過，需用 `git filter-repo` 清除歷史
- [ ] **L-3. 錯誤追蹤（Sentry）**
  - 現況：只有 `console.error`，production 無法看到
  - 行動：整合 Sentry（@sentry/cloudflare），前後端都要
  - 涵蓋：API route 錯誤、Pipeline 失敗、Queue 處理失敗、前端未捕獲異常
- [ ] **L-4. Rate Limiting**
  - 現況：完全沒有，任何人可無限打 API
  - 行動：
    - Cloudflare WAF rate limiting rules（最外層）
    - Hono middleware 或 Durable Object per-user 計數（應用層）
    - 至少保護：`/api/cases/:id/chat`（AI 成本高）、`/api/files`（上傳）
- [ ] **L-5. D1 資料庫備份**
  - 現況：無備份策略
  - 行動：Cloudflare Dashboard 開啟 D1 Time Travel（預設 30 天），定期用 `wrangler d1 export` 備份

- [ ] **L-6. Pipeline Token 用量追蹤（成本計算）**
  - 目的：每次產生書狀記錄各 provider 的 token 消耗，算出實際成本
  - 現況：只有 `reasoningStrategyStep.ts` 用 `console.log` 印 token，其他 11 個 AI 呼叫點有回傳 usage 但沒存
  - 需追蹤的 AI 呼叫點（按 pipeline step）：
    | Step | 函式 | Model | Provider |
    |------|------|-------|----------|
    | Step 0 Case Reader | `callAIStreaming()` | Gemini 2.5 Flash | Google AI Studio |
    | Step 0 Issue Analyzer | `callAI()` | Gemini 2.5 Flash | Google AI Studio |
    | Step 2 Reasoning Loop | `callClaudeToolLoop()` | Claude Haiku 4.5 | Anthropic |
    | Step 2 JSON Structuring | `callGeminiNative()` | Gemini 2.5 Flash | Google AI Studio |
    | Step 3 Writer (content) | `callClaudeWithCitations()` | Claude Sonnet 4.6 | Anthropic |
    | Step 3 Writer (intro/conclusion) | `callOpenRouterText()` | Gemini 3.1 Flash Lite | OpenRouter |
    | Template Rendering | `callOpenRouterText()` | Gemini 3.1 Flash Lite | OpenRouter |
  - 額外追蹤（非 pipeline，per-request）：
    | 場景 | 函式 | Model |
    |------|------|-------|
    | Chatbot 對話 | `callAIStreaming()` | Gemini 2.5 Flash |
    | 檔案處理（Queue） | `callAI()` + `callGeminiNative()` | Gemini 2.5 Flash Lite |
    | Inline AI（精簡/加強） | `callAI()` | Gemini 2.5 Flash Lite |
    | 分析工具（爭點/損害/時間軸） | `callGeminiNative()` | Gemini 2.5 Flash |
    | 品質審查 | `callClaude()` | Claude Haiku 4.5 |
  - 實作方案：
    - D1 新增 `ai_usage` 表：`id, case_id, brief_id?, step, model, provider, input_tokens, output_tokens, cache_write_tokens?, cache_read_tokens?, created_at`
    - 每個 AI 函式回傳 usage 後寫入（或收集到 ContextStore 最後批次寫入）
    - Claude 特別追蹤 cache tokens（影響計費：cache read 比 input 便宜 90%）
    - 前端或 admin 頁面可查看每份書狀的成本明細

### 🟡 強烈建議（上線品質保障）

- [ ] **L-6. 用戶行為分析（Analytics）**
  - 目的：了解用戶在用什麼功能、在哪卡住、轉換漏斗
  - 建議工具：**PostHog**（開源、自架或 Cloud，支援 event tracking + session replay + funnel）
  - 或輕量方案：**Google Analytics 4**（免費，但隱私顧慮較大）
  - 關鍵事件追蹤：
    | 事件 | 說明 |
    |------|------|
    | `case_created` | 新建案件 |
    | `file_uploaded` | 上傳檔案 |
    | `chat_message_sent` | 用戶發送對話 |
    | `brief_generated` | 書狀產生完成 |
    | `brief_exported_word` | Word 匯出 |
    | `dispute_edited` | 手動編輯爭點 |
    | `exhibit_reordered` | 證物重排 |
    | `pipeline_failed` | Pipeline 失敗 |
- [ ] **L-7. 用戶對話 Log 分析**
  - 目的：了解用戶都在問什麼、哪些問題 AI 答不好
  - 現況：`messages` 表已存 role + content，但沒有分析工具
  - 行動：
    - 定期匯出對話紀錄做分析（或接 PostHog custom event）
    - 記錄 tool_call 使用頻率（哪些工具最常被呼叫）
    - 記錄 pipeline 成功/失敗率 + 各 step 耗時
    - 可考慮加 `feedback` 欄位讓用戶對書狀按 👍/👎
- [ ] **L-8. Security Headers**
  - 現況：無任何安全 header
  - 行動：Hono middleware 加上：
    - `X-Frame-Options: DENY`
    - `X-Content-Type-Options: nosniff`
    - `Referrer-Policy: strict-origin-when-cross-origin`
    - `Content-Security-Policy`（根據實際資源來源配置）
- [ ] **L-9. Health Check Endpoint**
  - 現況：無健康檢查端點
  - 行動：`GET /api/health` 回傳 D1 連線狀態、版本號
  - 搭配外部 uptime monitoring（UptimeRobot / Better Uptime）
- [ ] **L-10. Pipeline 可觀測性**
  - 目的：上線後能追蹤 pipeline 問題
  - 行動：
    - 每個 step 記錄耗時（start/end timestamp）存入 D1 或 log
    - Pipeline 完成/失敗事件帶 case_id、step、duration、error
    - 接 Sentry performance monitoring 或自建 dashboard
- [ ] **L-11. 前端 console 清理**
  - 現況：32 個 `console.error` 散布各 store/component
  - 行動：保留但改為 Sentry capture（`Sentry.captureException(err)`），production build strip console

### 🟢 Nice-to-have（可上線後補）

- [ ] **L-12. 用戶回饋機制**
  - 書狀產出後的 👍/👎 + 文字回饋
  - 全局「回報問題」按鈕（浮動按鈕 → 回饋表單）
  - 資料存 D1 或 Google Form 簡易方案
- [ ] **L-13. CORS 配置**
  - 現況：同域部署不需要，但若 custom domain 與 Workers 分離則需設定
  - 行動：加 Hono CORS middleware，限定允許 origin
- [ ] **L-14. R2 版本控制**
  - 開啟 R2 object versioning，防止 PDF 意外覆蓋或刪除
- [ ] **L-15. 隱私政策 & 服務條款**
  - 法律服務產品，用戶上傳的是案件機密文件
  - 需要明確的資料處理聲明（資料存在哪、誰能存取、保留多久）
  - 頁面：`/privacy`、`/terms`
- [ ] **L-16. Onboarding 引導**
  - 新用戶首次進入的引導流程（tooltip tour 或示範案件）
  - 說明：上傳檔案 → AI 分析 → 產生書狀 的完整流程
- [ ] **L-17. 資料保留政策**
  - 定義多久後自動清理舊案件/舊對話
  - 用戶刪除帳號時完整清除所有關聯資料（GDPR-like）
