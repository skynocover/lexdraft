## ADDED Requirements

### Requirement: supplement 模式注入對方書狀

當 briefMode 為 `supplement` 時，pipeline SHALL 從卷宗中過濾 category 為 `brief_theirs`（或舊值 `brief`）的檔案，將其 content_md（fallback 到 full_text）截斷至 `FOCUS_DOC_MAX_LENGTH`（8000 字）後，注入 Step 2 reasoning prompt 的焦點專區。

#### Scenario: 有對方書狀時注入專區
- **WHEN** briefMode 為 `supplement` 且卷宗中存在 category 為 `brief_theirs` 的檔案
- **THEN** reasoning prompt 的 user message 中 SHALL 包含 `═══ 對造書狀（你需要逐點回應） ═══` 專區，內含每份對方書狀的檔名和 content_md 截斷內容

#### Scenario: 無對方書狀時 graceful degradation
- **WHEN** briefMode 為 `supplement` 但卷宗中無 `brief_theirs` 檔案
- **THEN** 焦點專區不出現，overlay 指引仍注入 system prompt，pipeline 正常執行（效果等同現行行為）

#### Scenario: 多份對方書狀全部注入
- **WHEN** 卷宗中有多份 `brief_theirs` 檔案
- **THEN** 每份各自截斷至 `FOCUS_DOC_MAX_LENGTH` 後全部注入專區

### Requirement: challenge 模式注入判決

當 briefMode 為 `challenge` 時，pipeline SHALL 從卷宗中過濾 category 為 `judgment` 的檔案，將其 content_md（fallback 到 full_text）截斷至 `FOCUS_DOC_MAX_LENGTH`（8000 字）後，注入 Step 2 reasoning prompt 的焦點專區。

#### Scenario: 有判決時注入專區
- **WHEN** briefMode 為 `challenge` 且卷宗中存在 category 為 `judgment` 的檔案
- **THEN** reasoning prompt 的 user message 中 SHALL 包含 `═══ 原審判決（你需要逐點指出錯誤） ═══` 專區，內含判決的檔名和 content_md 截斷內容

#### Scenario: 無判決時 graceful degradation
- **WHEN** briefMode 為 `challenge` 但卷宗中無 `judgment` 檔案
- **THEN** 焦點專區不出現，overlay 指引仍注入 system prompt，pipeline 正常執行

### Requirement: supplement overlay 指引

當 briefMode 為 `supplement` 時，reasoning system prompt SHALL 在 base workflow 之後追加 SUPPLEMENT_OVERLAY 指引，包含：
- 告知 AI 正在撰寫準備書狀，核心是回應對造上一輪攻防
- 指引優先從焦點專區識別對方的每項主張
- 指引對方的每個新主張都須逐點回應
- 指引可補充我方新的攻擊/防禦方法

#### Scenario: supplement 模式的 system prompt
- **WHEN** briefMode 為 `supplement`
- **THEN** system prompt SHALL 包含 base workflow（claim 或 defense，依 PipelineMode）加上 SUPPLEMENT_OVERLAY

#### Scenario: supplement 不替換 base workflow
- **WHEN** briefMode 為 `supplement`，clientRole 為 `defendant`
- **THEN** PipelineMode 為 `defense`，base workflow 使用 DEFENSE_REASONING_WORKFLOW，overlay 追加在後

### Requirement: challenge overlay 指引

當 briefMode 為 `challenge` 時，reasoning system prompt SHALL 在 base workflow 之後追加 CHALLENGE_OVERLAY 指引，包含：
- 告知 AI 正在撰寫上訴狀，核心是指出原判決錯誤
- 指引從焦點專區識別原判決的各項認定
- 指引按錯誤類型分類：事實認定錯誤、法律適用錯誤、判決理由矛盾、判決金額計算錯誤
- 指引每個上訴理由的結構：原判決認定 → 錯在哪裡 → 正確見解 → 法律依據

#### Scenario: challenge 模式的 system prompt
- **WHEN** briefMode 為 `challenge`
- **THEN** system prompt SHALL 包含 COMPLAINT_REASONING_WORKFLOW（PipelineMode 固定為 claim）加上 CHALLENGE_OVERLAY

### Requirement: 其他 briefMode 不受影響

briefMode 為 `claim`、`defense`、`petition` 時，pipeline SHALL 不注入焦點專區、不追加 overlay，行為與現行完全一致。

#### Scenario: claim 模式無 overlay
- **WHEN** briefMode 為 `claim`
- **THEN** system prompt 只包含 base workflow，無 overlay，user message 無焦點專區

#### Scenario: defense 模式無 overlay
- **WHEN** briefMode 為 `defense`
- **THEN** system prompt 只包含 base workflow，無 overlay，user message 無焦點專區

### Requirement: briefMode 傳遞至 prompt builders

`briefMode` SHALL 從 `PipelineContext` 傳遞至 `buildReasoningSystemPrompt()` 和 `buildReasoningStrategyInput()`，使其能根據 briefMode 組裝 overlay 和焦點專區。

#### Scenario: briefMode 可用於 prompt 組裝
- **WHEN** pipeline 執行 Step 2 reasoning
- **THEN** `buildReasoningSystemPrompt` 接收 `PipelineMode` 和 `briefMode` 兩個參數
- **AND** `buildReasoningStrategyInput` 的 input 包含 `briefMode` 和 `focusDocuments`

### Requirement: 焦點文件截斷常數

系統 SHALL 定義 `FOCUS_DOC_MAX_LENGTH = 8000` 常數，用於截斷焦點文件的 content_md。supplement 和 challenge 使用相同的截斷長度。

#### Scenario: 文件超過截斷長度
- **WHEN** 焦點文件的 content_md 超過 8000 字
- **THEN** 截斷至 8000 字並附加截斷標記

#### Scenario: 文件未超過截斷長度
- **WHEN** 焦點文件的 content_md 不超過 8000 字
- **THEN** 完整注入，不截斷
