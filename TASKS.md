# 法律書狀撰寫助手 — 完整實作規格書

> **目的**：本文件是給 Claude Code 實作用的完整規格書。涵蓋架構、資料模型、UI 結構、功能規格、API 設計。

---

## 1. 專案概述

### 1.1 產品定位
給台灣律師使用的 AI 書狀撰寫工作台。律師上傳案件卷宗（PDF），AI 分析文件、提取攻防關係、自動撰寫書狀草稿並附帶可驗證的引用。

### 1.2 核心使用場景
律師正在處理一個訴訟案件，已有十幾份文件（我方起訴狀、對方答辯狀、法院筆錄等）。律師需要針對對方最新一份答辯狀撰寫反駁書狀。AI 需要：
1. 理解所有文件的角色和內容
2. 識別對方的抗辯要點
3. 找出我方的反駁依據（先前書狀、筆錄中的有利證詞、相關法條）
4. 生成帶有精確引用的書狀草稿
5. 提供爭點分析、舉證缺口提醒

### 1.3 技術棧
| 層級 | 技術 |
|------|------|
| 前端 | React + Vite + Tailwind CSS + shadcn/ui |
| 書狀編輯器 | Tiptap（ProseMirror-based，可抽換架構） |
| ORM | Drizzle ORM |
| 後端 API | Hono API Routes |
| AI | Cloudflare AI Gateway |
| PDF 處理 | unpdf（基於 pdf.js，edge runtime 相容）。若相容性有問題則降級為 pdf-parse + nodejs_compat_v2 |
| Word 匯出 | docx（docx-js） |
| 狀態管理 | Zustand（按 domain 分 store） |
| 部署 | Cloudflare Workers + D1 + R2 + Queue + Durable Objects |
| 認證 | 簡單 email/password 登入（MVP 單人使用，PBKDF2 via Web Crypto API）|

---

## 2. 系統架構

### 2.1 整體流程
```
[律師上傳 PDF] → Workers API → 存 R2 + D1 寫 pending → 立即回應前端
                                    ↓
                              Queue Consumer
                                    ↓
                        pdf-parse 提取文字
                                    ↓
                    Haiku 摘要 + 自動分類 → 存回 D1（status: ready）
                                    ↓
                          前端 polling 更新狀態
```

### 2.2 為什麼不用 R2 Auto RAG
法律文件的使用場景跟一般 RAG 不同。律師的文件是一個案件的完整卷宗，每份文件角色明確（起訴狀、答辯狀、筆錄），AI 需要「理解整份文件在說什麼」而不是「從大量文件中搜尋片段」。Auto RAG 的 chunk-based 切割會破壞法律文件的上下文脈絡。一個案件通常 5-15 份文件，不需要向量搜尋的規模優勢。

### 2.3 文件處理策略：便宜模型摘要 + 按需讀原文
- **上傳時**：用 Haiku 對每份文件產生結構化摘要，存到 D1
- **撰寫時**：主 Agent 先看所有摘要清單，判斷哪幾份文件跟當前段落最相關（通常 3-5 份），再去 R2 拉原文
- **引用時**：把相關文件原文以 `document` content block 塞進 API 請求，開啟 `citations.enabled = true`

### 2.4 非同步檔案處理（避免 Workers timeout）
Workers Standard 的 wall time 限制是 30 秒，十幾份文件的 AI 摘要會超時。

**解法：兩層架構**
- **第一層（上傳 API）**：收到檔案 → 存 R2 → D1 寫 `status: pending` → 丟 Queue message → 立即回應前端「上傳成功」
- **第二層（Queue Consumer）**：每個 message 處理一份文件（15 分鐘時限），做 PDF 文字提取 → Haiku 摘要 + 分類 → 更新 D1 `status: ready`
- **前端**：polling `/api/files/status` 顯示「3/12 已處理」進度條

### 2.5 Agent Loop（Durable Objects）
Agent Loop 是 AI 執行多步驟任務的核心機制。例如律師說「撰寫準備二狀」，AI 不是一次 API call 完成，而是多輪迴圈：

```
第1輪: AI 呼叫 list_files → 看有哪些文件
第2輪: AI 呼叫 read_file (答辯三狀) → 讀對方主張
第3輪: AI 呼叫 read_file (筆錄) → 找有利證詞
第4輪: AI 呼叫 search_law → 找相關法條
第5輪: AI 呼叫 write_brief_section → 開始寫
...
```

每一輪都是一次 Claude API call，AI 根據前一輪結果決定下一步。這個流程可能要 2-3 分鐘，超過 Workers 的 30 秒 wall time 限制。

**解法：Durable Objects**
- 每個案件的 Agent 對話由一個 DO instance 執行，沒有嚴格 wall time 限制
- Workers 只負責接收 request 並轉發給 DO
- 已在 Cloudflare 生態系內（D1 + R2 + Queue），不需額外架 VPS

---

## 3. 資料模型（Drizzle ORM + D1）

> 使用 Drizzle ORM 定義 schema，搭配 D1 資料庫。MVP 階段為單人工具，所有表透過 `user_id` 關聯到 users 表（一對一）。

### 3.0 users — 用戶
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- nanoid
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,   -- PBKDF2 hash（Web Crypto API，不用 bcrypt，避免 Workers CPU 限制）
  name TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

### 3.1 cases — 案件
```sql
CREATE TABLE cases (
  id TEXT PRIMARY KEY,           -- nanoid
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,           -- "艾凡尼公司 v. 朱立家"
  case_number TEXT,              -- "114年度雄簡字第○○號"
  court TEXT,                    -- "高雄地方法院鳳山簡易庭"
  case_type TEXT,                -- "損害賠償" | "給付貨款" | ...
  plaintiff TEXT,                -- 原告名稱
  defendant TEXT,                -- 被告名稱
  created_at TEXT,
  updated_at TEXT
);
```

### 3.2 files — 案件卷宗檔案
```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  filename TEXT NOT NULL,         -- 原始檔名
  r2_key TEXT NOT NULL,           -- R2 存儲路徑
  file_size INTEGER,
  mime_type TEXT,                  -- "application/pdf"

  -- AI 處理結果
  status TEXT DEFAULT 'pending',  -- pending | processing | ready | error
  category TEXT,                  -- ours | theirs | court | evidence | other
  doc_type TEXT,                  -- complaint | defense | preparation | transcript | ruling | notice | evidence | other
  doc_date TEXT,                  -- AI 從內容提取的文件日期
  full_text TEXT,                 -- pdf-parse 提取的全文
  summary TEXT,                   -- Haiku 產生的結構化摘要（JSON）
  extracted_claims TEXT,          -- AI 提取的主張/抗辯（JSON array）

  created_at TEXT,
  updated_at TEXT
);
```

#### 3.2.1 category 自動分類邏輯
AI（Haiku）根據檔名 + 內容判斷：
- `ours`：包含「起訴狀」「準備狀」「準備○狀」且為我方
- `theirs`：包含「答辯」「答辯○狀」「爭點整理狀」且為對方
- `court`：包含「筆錄」「通知書」「裁定」「判決」
- `evidence`：合約、發票、照片、診斷證明等獨立證據
- `other`：無法分類

分類後律師可手動調整。

#### 3.2.2 summary 結構（JSON）
```json
{
  "type": "defense_brief",
  "party": "defendant",
  "summary": "被告提出三項抗辯：...",
  "key_claims": [
    "貨物存有隱藏性瑕疵",
    "已口頭通知解約",
    "金額計算有誤"
  ],
  "key_dates": ["2025-01-15", "2025-02-28"],
  "key_amounts": [380000],
  "contradictions": ["解約日期前後矛盾：1月 vs 2月底"],
  "judge_focus": null
}
```

法院筆錄的 summary 會額外包含 `judge_focus`（法官關注的問題）。

### 3.3 briefs — 書狀
```sql
CREATE TABLE briefs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  brief_type TEXT NOT NULL,       -- complaint | defense | preparation | appeal
  title TEXT,                     -- "民事準備二狀"
  content_structured TEXT,        -- 結構化段落（JSON，含引用資訊和段落-爭點映射）— 唯一 source of truth
  version INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
```

> **設計決策**：移除 `content_md`，以 `content_structured` 為唯一 source of truth。需要 Markdown 時從 structured JSON 即時生成，避免兩份資料的同步問題。

#### 3.3.1 content_structured 格式
```json
{
  "paragraphs": [
    {
      "id": "defect1",
      "section": "貳、就被告各項抗辯之反駁",
      "subsection": "一、關於貨物瑕疵之抗辯",
      "content_md": "被告主張貨物存有瑕疵...",
      "dispute_id": "1",
      "citations": [
        {
          "id": "c1",
          "label": "起訴狀 p.3",
          "type": "file",
          "file_id": "xxx",
          "location": { "page": 3, "char_start": 120, "char_end": 200 },
          "quoted_text": "被告於收受貨物時當場驗收簽認...",
          "status": "confirmed"
        }
      ]
    }
  ]
}
```

### 3.4 disputes — 爭點
```sql
CREATE TABLE disputes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  brief_id TEXT REFERENCES briefs(id),
  number INTEGER,                 -- 爭點編號 1, 2, 3...
  title TEXT,                     -- "貨物瑕疵 · 通知時效"
  our_position TEXT,              -- 我方主張
  their_position TEXT,            -- 對方主張
  evidence TEXT,                  -- 相關證據（JSON array of file_id + description）
  law_refs TEXT,                  -- 相關法條（JSON array）
  priority INTEGER DEFAULT 0     -- 排序優先級
);
```

### 3.5 law_refs — 法條引用
```sql
CREATE TABLE law_refs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  law_name TEXT,                  -- "民法"
  article TEXT,                   -- "§356"
  title TEXT,                     -- "從速檢查通知義務"
  full_text TEXT,                 -- 法條全文
  highlight_ranges TEXT,          -- 重點標記範圍（JSON）
  usage_count INTEGER DEFAULT 0
);
```

### 3.6 messages — 聊天記錄
```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,            -- nanoid
  case_id TEXT NOT NULL REFERENCES cases(id),
  role TEXT NOT NULL,             -- user | assistant | tool_call | tool_result
  content TEXT NOT NULL,          -- 訊息內容（assistant 可能含 citation JSON）
  metadata TEXT,                  -- JSON：tool name、tool args、citation data 等
  created_at TEXT
);
```

> 持久化聊天記錄，律師關閉瀏覽器後重新打開能看到完整對話歷史。`tool_call` / `tool_result` 記錄 Agent loop 的每一步，前端渲染為可收合的 Tool Call 卡片。

---

## 4. UI 結構

### 4.1 整體佈局
```
┌─ Header (48px) ────────────────────────────────────────────────────────┐
│ Logo · 案件名稱 · 書狀類型選單 · PDF/Word 下載                          │
├─────────┬──────────────────────────────────────┬───────────────────────┤
│         │                                      │                       │
│  Chat   │         書狀編輯器                     │   案件卷宗             │
│  (320px)│         (flex: 1)                     │   (240px)             │
│         │                                      │   ┌─ 📁 卷宗 ──────┐  │
│ ┌─────┐ │  ┌─ toolbar ────────────────────┐    │   │ ▾ 我方書狀 (3) │  │
│ │ msg │ │  │ 預覽/編輯 · 比對 · 引用審查   │    │   │ ▾ 對方書狀 (5) │  │
│ │ msg │ │  ├──────────────────────────────┤    │   │ ▾ 法院文件 (4) │  │
│ │ msg │ │  │                              │    │   │ ▾ 證據資料 (1) │  │
│ │ ... │ │  │      書狀預覽/編輯區域         │    │   │ ＋ 上傳        │  │
│ │     │ │  │      (段落 hover 有工具列)     │    │   ├───────────────┤  │
│ │     │ │  │                              │    │   │ ▾ ⚖ 法條 (5)  │  │
│ ├─────┤ │  │                              │    │   │  §354 · §356  │  │
│ │ 動態 │ │  ├── resize handle ────────────┤    │   │  §359 · §229  │  │
│ │ 快捷 │ │  │ ⚔️爭點 │ 💰金額 │ 📅時間軸    │    │   │  搜尋法條...   │  │
│ │ 按鈕 │ │  │ 🔗舉證 │ 👥當事人            │    │   └───────────────┘  │
│ ├─────┤ │  │ (sub-area, 可拖拉 100-500px) │    │                       │
│ │input│ │  │                              │    │                       │
│ └─────┘ │  └──────────────────────────────┘    │                       │
├─────────┴──────────────────────────────────────┴───────────────────────┤
│ Status Bar (26px): Model · Token usage · Cost · Citations API ✓        │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 三欄職責
| 欄 | 寬度 | 職責 |
|----|------|------|
| 左：聊天 | 320px 固定 | 律師下指令、AI 回應、tool call 卡片、進度條 |
| 中：編輯器 | flex: 1 | 書狀預覽/編輯（永遠可見）+ 底部案件分析面板 |
| 右：卷宗 | 240px 固定 | 案件文件（分類）+ 法條引用（寫作時隨時查） |

---

## 5. 功能規格

### 5.1 聊天面板

#### 5.1.1 訊息類型
- **用戶訊息**：律師的文字指令
- **AI 訊息**：回應文字
- **Tool Call 卡片**：可展開收合，顯示 tool name + 簡要結果。類型包含：
  - `read_file`：讀取文件（顯示檔名 + 摘要）
  - `search_law`：搜尋法條（顯示找到幾條）
  - `classify_files`：分類檔案（顯示分類結果）
  - `write_brief`：撰寫書狀（顯示進度）
- **進度條**：嵌入對話流，顯示撰寫進度 segments

#### 5.1.2 動態快捷按鈕（Feature 4）— 未來規劃
> **狀態：暫不實作**，列為未來規劃。MVP 階段聊天面板不顯示動態快捷按鈕。

快捷按鈕由 AI 根據當前書狀狀態動態生成，不是寫死的。

**生成邏輯**：每次書狀更新後，用 Haiku 分析以下內容，產出建議列表：
- 哪些段落缺少引用 → 紅點 `miss`，按鈕文字如「補慰撫金舉證」
- 哪些對方主張尚未回應 → 紅點 `miss`，如「回應答辯四狀」
- 哪些引用可以加強 → 黃點 `warn`，如「引用法官詢問」
- 通用改善建議 → 綠點 `tip`，如「加入判例比較」
- 資訊補充 → 藍點 `info`，如「強化對帳引用」

每個按鈕帶有預填的指令文字，點擊後填入聊天輸入框。

**資料結構**：
```typescript
interface QuickButton {
  label: string;          // "補慰撫金舉證"
  severity: 'miss' | 'warn' | 'tip' | 'info';
  prompt: string;         // 預填到輸入框的完整指令
}
```

### 5.2 書狀編輯器

#### 5.2.1 雙模式
- **預覽模式**（預設）：渲染格式化的書狀，serif 字體，支援引用標籤互動
- **編輯模式**：Tiptap 富文字編輯器，所見即所得

#### 5.2.1.1 編輯器可抽換架構
編輯器採用資料夾邊界 + Props 合約的方式實作，方便未來抽換底層套件：

```
src/components/editor/
  index.ts              ← re-export，外部只認這個入口
  types.ts              ← 合約：BriefEditorProps interface
  tiptap/               ← Tiptap 實作全部封在這裡
    TiptapEditor.tsx
    extensions/
      citation.ts
      paragraph-block.ts
```

**合約 interface**：
```typescript
interface BriefEditorProps {
  content: string                // markdown
  mode: 'preview' | 'edit'
  citations: Citation[]
  onContentChange: (md: string) => void
  onParagraphAction: (paragraphId: string, action: ParagraphAction) => void
  onCitationClick: (citationId: string) => void
  highlightParagraphs?: string[]
}
```

外部組件只 import `<BriefEditor>` 和 types，不直接碰 Tiptap API。抽換時只需新增實作資料夾並修改 `index.ts` 的 re-export。

#### 5.2.2 段落浮動工具列（Feature 1）
預覽模式下，每個語義段落（`<div data-p="...">`）hover 時在右上角顯示浮動工具列：

| 按鈕 | 行為 |
|------|------|
| ✨ AI 重寫 | 將「請重寫這段：『段落前30字...』」填入聊天輸入框，AI 只重新生成該段落 |
| 💪 加強 | 填入「請加強這段的論述...」 |
| 📎 插入引用 | 填入「請為這段插入適當的證據引用...」 |
| 🗑 刪除 | 視覺上標記刪除線 + 半透明，需確認 |

**技術實作**：
- 每個段落用 `data-p` attribute 標識 ID，用 `data-dispute` 標識對應爭點編號
- 浮動工具列用 CSS absolute positioning，hover 時 display:flex
- 點擊按鈕後，組裝指令字串，帶上段落 ID，塞入聊天輸入框
- AI 回應時根據段落 ID 只更新該段落，不動其他部分

#### 5.2.3 引用標籤（Citations）
書狀中的引用顯示為 inline badge：
- **證據引用**：藍底，如 `[起訴狀 p.3]`
- **法條引用**：紫底，如 `[§356]`
- **待確認引用**：黃色虛線邊框

Hover 時顯示浮動卡片（tooltip），包含：
- 來源文件名稱和位置
- 被引用的原文段落

**引用資料來自 Claude Citations API**：API 回傳的 citation block 包含 `cited_text`、`document_index`、`start_char_index`、`end_char_index`。前端解析後渲染成上述 badge。

#### 5.2.4 引用審查模式（Feature 5）
工具列顯示「6 確認 · 3 待確認 →」。點擊「待確認」進入審查流程：

1. 彈出 modal overlay
2. 顯示審查卡片：
   - 上方：來源文件名稱 + 原文段落
   - 下方：書狀中引用的文字
   - 按鈕：「✓ 確認正確」「移除引用」「跳過」
3. 書狀中對應的引用標籤閃爍高亮（`animation: pulse`）
4. 確認/移除後自動跳到下一個待確認引用
5. 全部審查完畢後關閉 modal

**狀態管理**：每個 citation 有 `status: 'confirmed' | 'pending' | 'rejected'`

#### 5.2.5 版本比對模式（Feature 3）
工具列的「📊 比對」按鈕，打開覆蓋在編輯器上方的比對面板：

- 頂部下拉選單選擇要比對的兩份文件：
  - 我方書狀之間（如「準備一狀 vs 準備二狀」）
  - 對方書狀之間（如「答辯三狀 vs 答辯二狀」）
- 左右雙欄 diff view
- 用顏色標示差異：
  - 綠色 `added`：新增內容
  - 紅色 `removed`：刪除內容（加刪除線）
  - 黃色 `changed`：修改內容
  - 灰色 `same`：未變動

**Diff 演算法**：對兩份文件的段落做語意層級的 diff（不是字元級），比較段落主題是否相同，新增了哪些主張。可用 Haiku 做語意比對，或用簡單的段落標題比對。

### 5.3 底部案件分析面板

#### 5.3.1 通用機制
- **可收合**：點擊 toggle bar 收合/展開
- **可拖拉高度**：resize handle 在 toggle bar 上方，拖拉調整高度 100px ~ 500px（Feature 6）
- **Tab 切換**：爭點 | 金額計算 | 時間軸 | 主張與舉證 | 當事人

#### 5.3.2 爭點分析（第一 Tab，最常用）
可展開收合的爭點卡片，每張包含：
- 編號 + 標題
- 「↗ 跳到段落」連結按鈕
- 展開後：我方主張、對方主張、證據、法條

**爭點 ↔ 段落雙向連動（Feature 2）**：
- **爭點 → 段落**：點「↗ 跳到段落」→ 書狀中所有 `data-dispute="N"` 的段落高亮（藍色 outline + 淡藍背景），自動滾動到第一個匹配段落。3 秒後取消高亮。
- **段落 → 爭點**：在書狀段落上**雙擊** → 底部自動打開（如果收合）、切換到爭點 tab、高亮對應爭點卡片、自動展開、滾動到可見。3 秒後取消高亮。

#### 5.3.3 金額計算（第二 Tab）
按類別的金額卡片（貨款、利息 等），每張顯示：
- 類別標題 + 小計
- 展開後每筆明細（品項 + 金額）
- 底部：請求總額 highlight bar

未來：支援律師直接修改金額，連動更新書狀訴之聲明段落。

#### 5.3.4 時間軸（第三 Tab）
垂直 timeline，按日期排序：
- 圓點顏色：紅色 = 關鍵事件、藍色 = 一般、綠色 = 當前
- 每個事件：日期、標題、描述、來源文件標記

#### 5.3.5 主張與舉證（第四 Tab）
表格形式的對照關係：
| 書狀主張 | 對應證據 | 狀態 |
|----------|----------|------|
| 被告積欠貨款 | 出貨單+對帳明細 | ✓ 已關聯 |
| 瑕疵通知逾期 | 筆錄 05/29 | ✓ 已關聯 |
| 金額 $380,000 | 原證七 | △ 補簽收單 |

狀態三種：`ok`（綠）、`warn`（黃，建議補充）、`miss`（紅，缺少證據）

#### 5.3.6 當事人（第五 Tab，最少用）
左右兩張卡片：原告 / 被告，各顯示：
- 姓名、身分證號、地址、電話、代理人等

### 5.4 右側卷宗面板

#### 5.4.1 案件卷宗區塊（可收合）
整個「案件卷宗」是一個可收合區塊，展開後包含四個檔案群組：

**四個群組，用顏色區分**：
| 群組 | 色碼 | 說明 |
|------|------|------|
| 🔵 我方書狀 | `#7c9aff` (--ac) | 起訴狀、準備狀 |
| 🟠 對方書狀 | `#f0983c` (--or) | 答辯狀、爭點整理狀 |
| 🔵 法院文件 | `#5cc8e0` (--cy) | 筆錄、通知書、裁定 |
| 🟢 證據資料 | `#5ce0a0` (--gr) | 獨立證據（合約、照片等） |

每個群組可獨立收合展開。

**檔案項目顯示**：
- PDF icon + 檔名 + 日期 + 處理狀態（✅ / ⏳ / ❌）
- 點擊展開：AI 摘要（我方文件顯示「AI 摘要」，對方文件顯示「AI 重點」）
- 展開後按鈕：「插入引用」「查看全文」

**特殊標記**：
- 本次反駁目標的文件（如對方最新答辯狀）用黃色字體 + ⭐ 標記
- AI 摘要用 tag 區分：綠色 `AI 摘要` vs 黃色 `AI 重點`

**上傳入口**：群組底部的虛線上傳區域，標註「AI 自動辨識分類」

#### 5.4.2 法條引用區塊（可收合）
緊接在卷宗下方的獨立可收合區塊。

**法條項目**：
- badge（民法/刑法/...）+ 條號 + 簡稱 + 引用次數
- 點擊展開：法條全文，關鍵文字用黃色高亮
- 展開後按鈕：「插入引用」

**搜尋法條**：底部輸入框 + 查詢按鈕。搜尋後 AI 找到相關法條加入列表。

#### 5.4.3 為什麼用可收合區塊堆疊而不是 Tab
- Tab 切換強迫二選一，但律師常需同時對照證據和法條
- 可收合區塊讓律師自主控制：可收起不需要的、可兩個都展開
- 每個檔案/法條本身也可展開（預設收合只顯示標題），節省空間
- 240px 寬度足夠堆疊兩個收合區塊

### 5.5 前端狀態管理（Zustand）

按 domain 分 store，避免單一大 store 造成不必要的 re-render：

| Store | 職責 |
|-------|------|
| `useCaseStore` | 案件資訊、檔案列表、檔案處理狀態 |
| `useBriefStore` | 書狀內容（content_structured）、引用狀態、爭點資料 |
| `useChatStore` | 聊天訊息列表、SSE streaming 狀態、Agent 進度 |
| `useUIStore` | 面板開合、tab 切換、底部面板高度等 UI 狀態 |

### 5.6 檔案上傳驗證

| 限制 | 值 |
|------|-----|
| 單檔大小上限 | 20MB（超過通常是掃描檔，文字提取效果差） |
| 允許類型 | `application/pdf`（MVP 只支援 PDF） |
| 單一案件檔案數上限 | 30 個 |

前端在選檔時即驗證，後端 API 也做二次驗證。超限時顯示明確錯誤訊息。

---

## 6. AI Agent 設計

### 6.1 Agent 架構
使用 Claude API 的 tool use 功能，Agent 有以下工具：

```typescript
const tools = [
  {
    name: "list_files",
    description: "列出案件所有檔案及其摘要",
    input_schema: { case_id: string }
  },
  {
    name: "read_file",
    description: "讀取指定檔案的完整文字內容",
    input_schema: { file_id: string }
  },
  {
    name: "search_law",
    description: "搜尋相關法條",
    input_schema: { query: string, law_name?: string }
  },
  {
    name: "write_brief_section",
    description: "撰寫或重寫書狀的某個段落",
    input_schema: {
      brief_id: string,
      paragraph_id?: string,  // 指定段落 ID 時只更新該段
      instruction: string,
      reference_file_ids: string[]  // 要參考的文件
    }
  },
  {
    name: "analyze_disputes",
    description: "分析案件爭點",
    input_schema: { case_id: string }
  },
  {
    name: "calculate_damages",
    description: "計算損害賠償金額",
    input_schema: { case_id: string }
  },
  {
    name: "generate_timeline",
    description: "生成案件時間軸",
    input_schema: { case_id: string }
  },
  // 未來規劃：動態快捷按鈕
  // {
  //   name: "suggest_improvements",
  //   description: "分析書狀並產生動態快捷按鈕建議",
  //   input_schema: { brief_id: string }
  // }
];
```

### 6.2 Agent 成本控制

| 機制 | 說明 |
|------|------|
| 單次 Agent loop 最大輪數 | 15 輪，超過自動停止並通知律師 |
| Token 用量回傳 | 每次 SSE 的 `done` event 附帶本次 input/output token 數 |
| Status bar 即時顯示 | 累計 token 用量 + 估算成本（NT$） |
| 月度 budget 上限（未來） | 可設定每月 token 預算，接近上限時告警 |

### 6.3 引用流程（Claude Citations API）
當 Agent 呼叫 `write_brief_section` 時：

1. 根據 `reference_file_ids` 從 D1/R2 拿到文件全文
2. 組裝 API 請求：
```typescript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: [
        // 文件作為 document content blocks
        {
          type: "document",
          source: { type: "text", media_type: "text/plain", data: file1FullText },
          title: "起訴狀",
          citations: { enabled: true }
        },
        {
          type: "document",
          source: { type: "text", media_type: "text/plain", data: file2FullText },
          title: "答辯三狀",
          citations: { enabled: true }
        },
        // 指令
        {
          type: "text",
          text: "請撰寫瑕疵抗辯的反駁段落..."
        }
      ]
    }
  ]
});
```

3. API 回傳的 content 是 text block 和 citation block 交錯：
```json
[
  { "type": "text", "text": "被告主張貨物存有瑕疵，惟查..." },
  {
    "type": "cite",
    "cited_text": "被告於收受貨物時當場驗收簽認...",
    "document_index": 0,
    "document_title": "起訴狀",
    "start_char_index": 120,
    "end_char_index": 180
  },
  { "type": "text", "text": "且依言詞辯論筆錄..." }
]
```

4. 前端解析 citation blocks，渲染成可互動的引用標籤

### 6.4 法條搜尋（search_law）

> **資料來源**：待提供外部法條查詢 API + API Key。Agent 的 `search_law` tool 呼叫此 API 取得法條全文，結果存入 `law_refs` 表供後續引用。

### 6.5 文件分類 Prompt（給 Haiku）
```
你是法律文件分類助手。根據以下檔案名稱和內容，判斷：

1. category: ours（我方書狀）| theirs（對方書狀）| court（法院文件）| evidence（證據）| other
2. doc_type: complaint | defense | preparation | transcript | ruling | notice | evidence | other
3. doc_date: 文件日期（YYYY-MM-DD）
4. summary: 結構化摘要（含 key_claims, key_dates, key_amounts, contradictions）

如果是對方書狀，特別注意提取：
- 所有抗辯要點
- 前後矛盾之處

如果是法院筆錄，特別注意提取：
- 法官詢問的問題和關注的重點
- 雙方在庭上的回答

回傳 JSON 格式。
```

---

## 7. API Routes

### 7.1 端點清單
```
POST   /api/cases                    建立案件
GET    /api/cases/:id                取得案件
PUT    /api/cases/:id                更新案件

POST   /api/cases/:id/files          上傳檔案（multipart）
GET    /api/cases/:id/files           列出檔案
GET    /api/cases/:id/files/status   檔案處理狀態（polling 用）
PUT    /api/files/:id                更新檔案（手動修改分類等）
DELETE /api/files/:id                刪除檔案
GET    /api/files/:id/content        取得檔案全文

POST   /api/cases/:id/chat           聊天（streaming SSE）
POST   /api/cases/:id/chat/cancel   取消進行中的 Agent loop
GET    /api/cases/:id/messages       取得聊天記錄（分頁）

GET    /api/cases/:id/briefs         列出書狀
GET    /api/briefs/:id               取得書狀內容
PUT    /api/briefs/:id               更新書狀

GET    /api/cases/:id/disputes       取得爭點
GET    /api/cases/:id/timeline       取得時間軸
GET    /api/cases/:id/damages        取得金額計算
GET    /api/cases/:id/parties        取得當事人
GET    /api/cases/:id/law-refs       取得法條引用

POST   /api/briefs/:id/export/docx   匯出 Word
POST   /api/briefs/:id/export/pdf    匯出 PDF

POST   /api/law/search               搜尋法條
```

### 7.2 聊天 API（SSE Streaming）
`POST /api/cases/:id/chat` 使用 Server-Sent Events 串流回應：

```typescript
// Event types:
data: { "type": "tool_call_start", "name": "read_file", "args": {...} }
data: { "type": "tool_call_end", "name": "read_file", "result": "摘要..." }
data: { "type": "text_delta", "text": "被告主張..." }
data: { "type": "citation", "cited_text": "...", "document_index": 0, ... }
data: { "type": "brief_update", "paragraph_id": "defect1", "content": "..." }
// 未來規劃: data: { "type": "suggestions", "buttons": [...] }
data: { "type": "done" }
```

---

## 8. Word 匯出規格

使用 `docx`（docx-js）生成 .docx 檔案。

### 8.1 書狀格式
- **紙張**：A4（台灣法院標準）
- **邊距**：上下 2.54cm，左右 3.17cm
- **字體**：標楷體（heading）、新細明體（body），如系統不支援則用 Noto Serif TC
- **字級**：標題 18pt、小標 14pt、內文 12pt
- **行距**：1.8 倍

### 8.2 引用在 Word 中的呈現
引用標籤在 Word 中轉換為括號引用，如 `（原證一，事故分析研判表）`，不使用互動元素。

### 8.3 中文字體策略
docx-js 無法嵌入字體檔。策略：
- Word 檔指定字體名稱為「標楷體」/「新細明體」（台灣法院電腦幾乎都有安裝）
- 若律師電腦未安裝，Word 會自動 fallback 到系統預設中文字體
- 律師下載後應確認排版，必要時手動調整字體
- PDF 匯出可嵌入 Noto Serif TC 字體，作為確保排版一致的備選格式

---

## 9. 色彩系統

深色主題，適合長時間閱讀。

```css
/* 背景層級 */
--bg-0: #0c0d12;  /* 最深，編輯器背景 */
--bg-1: #12131a;  /* 面板背景 */
--bg-2: #1a1b24;  /* 卡片背景 */
--bg-3: #22232e;  /* 輸入框、按鈕背景 */
--bg-4: #2a2c3a;  /* tooltip 背景 */
--bg-h: #2f3145;  /* hover 狀態 */

/* 邊框 */
--bd:   #262838;  /* 一般邊框 */
--bd-l: #353750;  /* 強調邊框 */

/* 文字 */
--t1: #eaebf0;   /* 主要文字 */
--t2: #a0a3b5;   /* 次要文字 */
--t3: #6c6f85;   /* 輔助文字 */

/* 功能色 */
--ac: #7c9aff;   /* 主色調（藍），用於我方、連結、主要操作 */
--gr: #5ce0a0;   /* 綠色，成功、已確認 */
--yl: #f0c850;   /* 黃色，警告、待確認 */
--rd: #f07068;   /* 紅色，錯誤、缺失、PDF icon */
--or: #f0983c;   /* 橙色，對方相關 */
--pu: #b09cff;   /* 紫色，法條相關 */
--cy: #5cc8e0;   /* 青色，法院文件相關 */
```

---

## 10. 實作優先順序

### Phase 1 — 核心可用
1. 基礎 UI 三欄佈局（Chat + Editor + Right sidebar）
2. 檔案上傳 + Queue 非同步處理 + 自動分類
3. 右側卷宗面板（四個群組 + 展開摘要）
4. Agent 基礎 loop（list_files, read_file, write_brief_section）
5. Citations API 整合 + 引用標籤渲染
6. Word 匯出

### Phase 2 — 提升體驗
7. 段落浮動工具列（Feature 1）
8. 引用審查模式（Feature 5）
9. 法條搜尋整合
10. 底部分析面板（爭點、金額、時間軸、舉證）

### Phase 3 — 進階功能
11. 爭點 ↔ 段落雙向連動（Feature 2）
12. 版本比對模式（Feature 3）
13. 底部面板可拖拉高度（Feature 6）
14. 金額修改連動訴之聲明
15. 多版本書狀管理

### 未來規劃
- 動態快捷按鈕（Feature 4）：AI 根據書狀狀態動態生成建議按鈕
- 多用戶 / 團隊協作（RBAC、案件權限控管）

---

## 11. 關鍵設計決策記錄

| 決策 | 選擇 | 原因 |
|------|------|------|
| 前端框架 | React + Vite | 搭配 shadcn/ui、Tiptap 等 React 生態套件 |
| ORM | Drizzle ORM | 類型安全、D1 原生支援、輕量 |
| 狀態管理 | Zustand（按 domain 分 store） | 輕量、不需 Provider、按 domain 分 store 避免不必要 re-render |
| 書狀編輯器套件 | Tiptap（可抽換架構） | 自定義 node/mark 容易、React 一級支援、社群活躍。透過 Props 合約 + 資料夾邊界隔離，未來可抽換為 Milkdown 或其他 |
| PDF 文字提取 | unpdf（優先）/ pdf-parse（備選） | unpdf 基於 pdf.js，專為 edge runtime 設計。pdf-parse 依賴 Node.js API，需 nodejs_compat_v2 |
| PDF 處理策略 | 便宜模型摘要，不用 Auto RAG | 法律文件需要完整上下文，不適合 chunk-based 檢索 |
| 引用機制 | Claude Citations API | 模型原生支援，準確率比 prompt 高 15%，不需自建 RAG |
| 多檔案處理 | Queue 非同步 | 避免 Workers 30 秒超時 |
| Agent loop | Durable Objects | 多輪 tool use 需超過 30 秒，DO 無嚴格 wall time 限制，且留在 CF 生態系內 |
| Agent 串流 | SSE（非 WebSocket） | 互動本質是 request-response + streaming，SSE 更簡單。取消用獨立 POST endpoint。未來若需雙向通訊再考慮 WebSocket |
| 認證 | email/password + PBKDF2（MVP） | 單人工具，不需 OAuth。PBKDF2 用 Web Crypto API，不會撞 Workers CPU 限制（bcrypt 會） |
| 密碼雜湊 | PBKDF2（Web Crypto API） | bcrypt 是 CPU-intensive，在 Workers 10ms CPU 限制下會超時。PBKDF2 由 Web Crypto API 原生支援 |
| 書狀資料 | content_structured 為唯一 source of truth | 移除 content_md 避免雙份資料同步問題，需要 markdown 時即時生成 |
| 聊天記錄 | 持久化到 messages 表 | 律師關閉瀏覽器後需能看到完整對話歷史，包含 tool call 記錄 |
| 書狀編輯器 | 永遠可見（不是 tab） | 律師寫書狀是核心動作，不能被其他面板遮擋 |
| 右側面板 | 可收合區塊堆疊 | 律師需同時看證據和法條，tab 強迫二選一 |
| 檔案管理 | 不獨立於證據 | 上傳的 PDF 就是卷宗，按角色分類比按功能分類更直覺 |
| 底部分析面板 | Tab 排序：爭點 > 金額 > 時間軸 > 舉證 > 當事人 | 按使用頻率和行動指導性排序 |
| 書狀段落 hover | 浮動工具列而非全文編輯 | 律師改書狀是「一段一段改」，段落操作比全文編輯精準 |
| 動態快捷按鈕 | 未來規劃 | MVP 暫不實作，避免額外 API 成本和複雜度 |
| 法條搜尋 | 外部 API（待提供） | 待整合法條查詢 API + Key |