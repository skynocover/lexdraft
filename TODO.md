# LexDraft — 開發計劃

> 依 ROI 排序。核心目標：讓律師產出可直接送法院的書狀，只需 10-15 分鐘校閱。

---

## 快速改善（1 天內可完成）

- [ ] **P1-5. 結論字數控制（prompt 層）**
  - 目標 100-200 字，目前實際產出 349-435 字
- [ ] **Infra-2. AI API retry with exponential backoff**
  - AI 呼叫偶發失敗時自動重試，提升 pipeline 穩定性
  - Queue Consumer：失敗時寫回 D1
- [ ] **L-2. 環境變數安全化**
  - `.env` 和 `.dev.vars` 加入 `.gitignore`
  - `wrangler secret put` 設定 production secrets，輪替已暴露 credentials
  - ⚠️ repo 曾公開過需用 `git filter-repo` 清除歷史
- [ ] **L-5. D1 資料庫備份**（非程式碼：Cloudflare Dashboard 開啟 D1 Time Travel 即可）

---

## 功能開發（按 ROI 排序）

- [ ] **P2-6. 律師手動調整推理**
  - 前端「調整推理」按鈕，讓律師能修改 claims 或 legal_reasoning 後重新生成書狀
  - 從「全自動」變成「人機協作」
  - ✅ 部分完成：爭點標題 inline edit + 爭點刪除（cascade delete 關聯 claims）— PATCH/DELETE `/api/cases/:caseId/disputes/:id`
- [ ] **P2-3. 對造書狀攻防強化**
  - 現有基礎已可運作：`fileProcessor` 自動分類 `category: 'theirs'`，Step 2 reasoning 有完整 `ours/theirs` claims 攻防結構
  - 強化項：prompt 更明確強調「優先針對 theirs 文件中的主張進行逐一反駁」
  - 準備書狀場景：查詢本案已有書狀，注入前狀 context 供 AI 參考
  - 先實測品質再決定調整幅度
- [ ] **P2.5-1. 多書狀工作空間**
  - 同一案件支援多份書狀（起訴狀 + 答辯狀 + 準備書狀）
  - Tab 切換方式，複用 `useTabStore`
  - `useBriefStore` 改為 `activeBriefId` + `briefs[]`
- [ ] **P2.5-2. 書狀品質審查（Review Step）**
  - Pipeline Step 3 完成後自動跑品質審查，標記有風險的段落
  - Layer 1：純程式碼驗證（金額一致性、證物引用存在性、爭點覆蓋率、段落長度異常）
  - Layer 2：Gemini Flash 單次呼叫驗證（主張 vs 證據對應、法條 vs 論證一致、事實前後矛盾）
  - 前端段落標記（紅 critical / 黃 warning），點擊展開問題描述
  - 設計文件：`docs/design-review-step.md`
- [ ] **P3-1. 判例搜尋與引用**
  - 真正的書狀會引用判決字號（如「最高法院 108 年度台上字第 123 號判決參照」）
  - 需要新 DB/向量搜尋基礎建設，對品質影響大但建設成本高
  - Step 2 tool-loop 架構天然支持新增 `search_precedent` 工具

---

## 上線前置（必做）

- [ ] **L-1. 認證系統（取代 dev-token）**
  - 現況：單一 Bearer token，所有用戶共用 `DEFAULT_USER_ID = 'default-user'`
  - 目標：Email/password 登入，JWT + refresh token，多用戶隔離
- [ ] **L-3. 錯誤追蹤（Sentry）**
  - 整合 `@sentry/cloudflare`，前後端都要
  - 涵蓋：API route 錯誤、Pipeline 失敗、Queue 處理失敗、前端未捕獲異常
- [ ] **L-4. Rate Limiting**
  - Cloudflare WAF rate limiting rules（最外層）
  - Hono middleware 或 Durable Object per-user 計數（應用層）
  - 至少保護：`/api/cases/:id/chat`（AI 成本高）、`/api/files`（上傳）
- [ ] **L-6. Pipeline Token 用量追蹤（成本計算）**
  - 每次產生書狀記錄各 provider 的 token 消耗，算出實際成本
  - D1 新增 `ai_usage` 表：`id, case_id, brief_id?, step, model, provider, input_tokens, output_tokens, cache_write_tokens?, cache_read_tokens?, created_at`
  - 需追蹤的 AI 呼叫點：
    | Step | 函式 | Model | Provider |
    |------|------|-------|----------|
    | Step 0 Case Reader | `callAIStreaming()` | Gemini 2.5 Flash | Google AI Studio |
    | Step 0 Issue Analyzer | `callAI()` | Gemini 2.5 Flash | Google AI Studio |
    | Step 2 Reasoning Loop | `callClaudeToolLoop()` | Claude Haiku 4.5 | Anthropic |
    | Step 2 JSON Structuring | `callGeminiNative()` | Gemini 2.5 Flash | Google AI Studio |
    | Step 3 Writer (content) | `callClaudeWithCitations()` | Claude Sonnet 4.6 | Anthropic |
    | Step 3 Writer (intro/conclusion) | `callOpenRouterText()` | Gemini 3.1 Flash Lite | OpenRouter |
    | Template Rendering | `callOpenRouterText()` | Gemini 3.1 Flash Lite | OpenRouter |

---

## 商業化

- [ ] **P4-1. Email/password 認證**（與 L-1 合併實作）
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
    1. 用戶說「幫我寫起訴狀」→ AI 回傳確認卡片（SSE `brief_confirm`）
    2. 前端顯示確認卡片：書狀類型、消耗額度、剩餘額度、確認/取消
    3. 確認後執行 pipeline → 扣額度；額度不足 → 升級方案按鈕
- [ ] **P4-3. 多用戶 / RBAC**
  - 團隊協作、案件權限控管，早期不需要

---

## 上線後補強

- [ ] **L-7. 用戶行為分析（PostHog / GA4）**
  - 追蹤事件：case_created, file_uploaded, brief_generated, brief_exported_word, pipeline_failed 等
- [ ] **L-8. 用戶對話 Log 分析**
  - `messages` 表已存 role + content，需匯出分析工具
  - 考慮加 `feedback` 欄位讓用戶對書狀按 👍/👎
- [ ] **L-10. Pipeline 可觀測性**（依賴 L-3 Sentry）
  - 每個 step 記錄耗時，完成/失敗事件帶 case_id、step、duration、error
- [ ] **L-11. 前端 console 清理**（依賴 L-3 Sentry）
  - 32 個 `console.error` 改為 `Sentry.captureException(err)`
- [ ] **L-12. 用戶回饋機制** — 👍/👎 + 文字回饋
- [ ] **L-13. CORS 配置** — 同域部署暫不需要
- [ ] **L-14. R2 版本控制** — 開啟 object versioning
- [ ] **L-15. 隱私政策 & 服務條款** — `/privacy`、`/terms` 頁面
- [ ] **L-16. Onboarding 引導** — 新用戶引導流程
- [ ] **L-17. 資料保留政策** — 自動清理舊資料、帳號刪除

---

## 降級 / 暫緩

| 項目 | 降級理由 |
| ---- | -------- |
| 案型速查表 | AI reasoning + 補搜機制已解決法條覆蓋率，ROI 大幅下降 |
| 相鄰條群規則表 | 同上，Step 2 已能主動補搜相關法條 |
| 金額↔書狀雙向同步 | 實作複雜度極高，pipeline 已能從 damages 表正確帶入金額 |
| PDF 匯出 | 台灣法院收 Word 為主，需求極低 |
| 響應式佈局 | 律師辦公環境幾乎都是大螢幕 |
| 快捷鍵 | Polish 項目，不影響核心價值 |
| 書狀類型擴展（上訴狀等） | 等實際需求再加 |
| AI 一鍵初始化（P2-2） | 用戶聊天說一句即可觸發，ROI 不高 |
| Pipeline 錯誤恢復（Infra-0） | checkpoint + 斷點重跑屬 over design |
| Health Check（L-9） | Workers 是 serverless，不需要 |
| 引用審查 UX（P2-1） | 現有 hover popover + 點擊開檔已夠用 |
| 版本比對 diff view（P3-3） | 工程量大，brief_versions 手動切換夠用 |
| Smart Chips | 酷但非必要 |
| 全文搜尋 | 案件檔案不多時用不到 |
| 時間軸獨立 tab | 形式待定 |
| 配置清理 | 工程衛生，視需要穿插進行 |

---

## 書狀品質差距分析（2026-03-07）

> 基於車禍案 pipeline 產出（law=20, file=48, total=68, 0-law=0/6）

### 致命硬傷

| 問題 | 說明 | 對應功能 |
| ---- | ---- | -------- |
| **沒有判決引用** | 只引用法條，零判決。精神慰撫金、工作損失等缺類案判決佐證 | P3-1 判例搜尋 |
| **管轄法院錯誤** | Header 帶入錯誤法院，會被退件（✅ 已新增庭別欄位，法院需用戶手動選擇） | — |

### 思考深度不足

| 問題 | 目前書狀 | 律師期望 |
| ---- | -------- | -------- |
| **反駁太淺** | 「有證據支持，故合理」 | 逐項拆解金額、引用判決說明認定標準 |
| **請求權基礎不完整** | 只用 §184(1) + §191-2 | 應加 §184(2)（違反保護他人之法律），舉證責任倒置 |
| **精神慰撫金論述弱** | 「傷害程度重於輕傷」 | 需列舉類案判決金額，說明本案情節相當 |

### 結論

書狀架構、論證邏輯、事實引用已達 70 分水準。**判決引用**是拉到 90 分的關鍵——補上後律師工作量從「重寫」降到「微調」。
