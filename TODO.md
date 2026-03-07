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
  - Render-time mapping：citation 顯示時查詢 exhibitMap，不修改 content_structured
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
  - cases 表可能需新增欄位：`plaintiff_address`、`defendant_address`、`judge_division`（股別）
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
- [ ] **P2-5. 案型法律知識庫**
  - 按案型（車禍、醫療、勞資）硬編碼常見法律議題及攻防要點
  - 如：車禍物損 → 折舊抗辯、精神慰撫金 → 兩造身分地位資力、不能工作 → 職業特殊性
  - 注入 Step 2 reasoning prompt，提升法律推理深度
- [ ] **P2-6. 律師手動調整推理**
  - 前端「調整推理」按鈕，讓律師能修改 claims 或 legal_reasoning 後重新生成書狀
  - 從「全自動」變成「人機協作」，vibe coding 的核心體驗

---

## Phase 3 — 差異化功能

> 讓產品從「能替代人工」變成「超越人工」

- [ ] **P3-1. 判例搜尋與引用**
  - 真正的書狀會引用判決字號（如「最高法院 108 年度台上字第 123 號判決參照」）
  - 需要新 DB/向量搜尋基礎建設，對品質影響大但建設成本高
  - Step 2 tool-loop 架構天然支持新增 `search_precedent` 工具
- [ ] **P3-2. 爭點↔書狀段落跳轉**
  - 右側爭點卡片點擊 → 跳到書狀對應段落
  - 幫律師快速 review AI 有沒有漏掉爭點
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
- [ ] **Infra-1. Zod 驗證層**
  - 為所有 API route 的 request body 加入 Zod schema 驗證
  - Agent tool arguments 加入 runtime Zod 驗證
  - 統一錯誤回傳格式：`{ error: string, details?: ZodError['issues'] }`
- [ ] **Infra-2. 統一錯誤處理**
  - AppError class + Hono global error handler
  - AI API 呼叫：retry with exponential backoff（最多 3 次）
  - Queue Consumer：失敗時寫回 D1（status: error + error_message）

---

## 降級 / 暫緩

| 項目 | 原 Tier | 降級理由 |
|------|---------|---------|
| 案型速查表 | S1 → 基礎建設 | AI reasoning + 補搜機制已解決法條覆蓋率（本次 9 條法條、0/6 sections 缺法條），作為 safety net 仍有價值但 ROI 大幅下降 |
| 相鄰條群規則表 | S2 → 基礎建設 | 同上，Step 2 已能主動補搜相關法條（§213、§217） |
| 金額↔書狀雙向同步 | B2 → 暫緩 | 實作複雜度極高，且 pipeline 已能從 damages 表正確帶入金額（5 項全部吻合） |
| PDF 匯出 | C3 → 暫緩 | 台灣法院收 Word 為主，A1 做完後需求極低 |
| 響應式佈局 | C5 → 暫緩 | 律師辦公環境幾乎都是大螢幕 |
| 快捷鍵 | C6 → 暫緩 | Polish 項目，不影響核心價值 |
| 配置清理 | C4 → 暫緩 | 工程衛生，視開發需要穿插進行 |
| 書狀類型擴展（上訴狀等） | 暫緩 | 現有範本系統已涵蓋起訴狀/答辯狀/準備書狀的格式差異；上訴狀攻防結構不同（攻擊判決理由），等實際需求再加程式邏輯 |
| Smart Chips | 暫緩 | 酷但非必要 |
| 全文搜尋 | 暫緩 | 案件檔案不多時用不到 |
| 時間軸獨立 tab | 暫緩 | 形式待定 |

---

## 已完成

- [x] **模板系統**（原 B1）
  - 預設書狀模板、自動選擇、範本編輯器、Pipeline Step 2 注入
- [x] **前端錯誤 toast 通知**（原 S4）
  - sonner 整合、API 層統一攔截
- [x] **`legal_reasoning` 結構化**
  - 已在 `StrategySection.legal_reasoning` 實作
