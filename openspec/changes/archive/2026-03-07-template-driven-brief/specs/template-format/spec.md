## ADDED Requirements

### Requirement: Template 是完整書狀骨架

每份 template 的 `content_md` SHALL 包含完整的書狀 markdown 骨架，分為三個區域：
1. **Header 區**：第一個 `##` 之前的所有內容（案號、當事人資訊）
2. **Body 區**：所有 `##` 段落（訴之聲明、前言、事實及理由、結論、證據方法等）
3. **Footer 區**：最後一個 `---` 之後的所有內容（謹狀、法院、具狀人、日期）

#### Scenario: 起訴狀 template 包含三個區域
- **WHEN** 載入一份民事起訴狀 template
- **THEN** content_md 包含 header 區（案號、原告、被告）、至少 3 個 `##` 段落、以及 `---` 之後的 footer 區

#### Scenario: 強制執行 template 使用不同稱謂
- **WHEN** 載入一份聲請強制執行狀 template
- **THEN** header 區使用「債權人」「債務人」稱謂，footer 區使用「民事執行處」

### Requirement: Template 不含特殊語法

Template 的 content_md SHALL 為純 markdown，不使用 `{{placeholder}}`、`<!-- -->`、YAML frontmatter 或任何自訂語法。

- 待填欄位使用【待填：描述】格式
- 空白欄位使用 ○○○ 或 ＿＿ 佔位
- 指引文字直接寫為段落內容（非 comment）

#### Scenario: 律師在 TemplateEditor 看到可讀文字
- **WHEN** 律師在 TemplateEditor 開啟一份 template
- **THEN** 所有內容皆為可見的中文文字，不出現 `{{`、`<!--`、`---\n`（YAML frontmatter）

### Requirement: 一個 template 對應一種具體書狀

每份 template SHALL 對應一種具體的書狀類型（如「民事起訴狀（損害賠償）」），不可涵蓋多種書狀。

#### Scenario: 預設範本各自獨立
- **WHEN** 列出所有預設範本
- **THEN** 每個範本的 title 對應一種具體書狀（不出現「通用」或涵蓋多種書狀的範本）

### Requirement: 預設範本從 ref/templates 濃縮

系統 SHALL 提供 4-8 個預設範本（is_default=1），從 ref/templates 的類別參考範本中拆出，每個 30-50 行。

至少包含：
- 民事起訴狀（一般）
- 民事起訴狀（損害賠償）
- 民事答辯狀
- 民事準備書狀

#### Scenario: 預設範本可開箱使用
- **WHEN** 新使用者開啟系統
- **THEN** 可看到至少 4 個預設範本，每個都能直接用於生成書狀

### Requirement: 不使用範本時有通用 fallback

當 case.template_id 為 null 或 'auto' 且 AI 未選擇範本時，pipeline SHALL 使用一段通用 fallback 指引，包含基本段落結構（前言 → 事實及理由 → 結論）。

#### Scenario: 無 template 仍可生成書狀
- **WHEN** 案件未設定 template_id 且 AI 未自動選擇範本
- **THEN** pipeline 使用 fallback 指引生成書狀，包含前言、事實及理由、結論三個基本段落

### Requirement: AI 可自動選擇範本

Orchestrator agent SHALL 能看到預設範本清單（title + category），根據案件性質自動選擇最適合的 template。

#### Scenario: AI 為車禍案選擇損害賠償範本
- **WHEN** 案件描述包含車禍損害賠償相關內容
- **THEN** orchestrator 選擇「民事起訴狀（損害賠償）」範本

### Requirement: briefs 表 brief_type 改為 template_id

`briefs` 表 SHALL 移除 `brief_type` 欄位，新增 `template_id`（text, nullable）欄位，記錄生成時使用的範本 ID。

#### Scenario: 建立新書狀時記錄 template_id
- **WHEN** pipeline 生成一份使用「民事答辯狀」template 的書狀
- **THEN** briefs 記錄中 template_id 為該範本的 ID

#### Scenario: 不使用範本時 template_id 為 null
- **WHEN** pipeline 生成書狀但未使用任何範本
- **THEN** briefs 記錄中 template_id 為 null
