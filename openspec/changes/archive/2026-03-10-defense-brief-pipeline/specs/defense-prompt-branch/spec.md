## ADDED Requirements

### Requirement: Pipeline prompt 根據 template_id 切換模式
Pipeline 的三個 prompt 來源（reasoningStrategyPrompt、strategyConstants、writerStep）SHALL 根據 `template_id` 選擇攻擊模式或防禦模式的 prompt 文字。

#### Scenario: 使用答辯狀 template
- **WHEN** `template_id` 為 `default-civil-defense`
- **THEN** Step 2 使用防禦模式 reasoning prompt，Step 3 使用防禦模式 writer instruction

#### Scenario: 使用準備書狀 template
- **WHEN** `template_id` 為 `default-civil-preparation`
- **THEN** Step 2 使用防禦模式 reasoning prompt，Step 3 使用防禦模式 writer instruction

#### Scenario: 使用起訴狀 template
- **WHEN** `template_id` 為 `default-civil-complaint` 或 `default-civil-complaint-damages`
- **THEN** Step 2 和 Step 3 使用現有攻擊模式 prompt（行為不變）

#### Scenario: 未知 template_id
- **WHEN** `template_id` 不在已知清單中
- **THEN** fallback 使用攻擊模式 prompt

### Requirement: 答辯狀 reasoning prompt 使用三層推理框架
防禦模式的 reasoning system prompt SHALL 引導 AI 進行三層推理：解構 → 防禦 → 攻擊。

#### Scenario: Layer 1 解構 — 拆解原告主張
- **WHEN** AI 進入 reasoning 階段
- **THEN** AI SHALL 逐一識別原告的每個主張，並分類為「事實否認」「法律爭執」或「全部承認」

#### Scenario: Layer 2 防禦 — 找出舉證弱點
- **WHEN** AI 完成主張分類
- **THEN** AI SHALL 對「否認」和「爭執」的主張，分析舉證責任歸屬、找出原告舉證漏洞、準備反證

#### Scenario: Layer 3 攻擊 — 積極抗辯
- **WHEN** AI 完成防禦分析
- **THEN** AI SHALL 檢查是否有可用的積極抗辯（時效、過失相抵、損益相抵等），如有則規劃為獨立段落

### Requirement: 答辯狀 claims 規則
防禦模式的 claims 規則 SHALL 反映答辯狀的攻防結構。

#### Scenario: claims 分類
- **WHEN** 策略輸出 claims
- **THEN** `theirs` claims 為原告的各項主張（primary），`ours` claims 多為 rebuttal（回應原告）加少數 primary（積極抗辯），每個 rebuttal MUST 有 `responds_to`

### Requirement: 答辯狀段落結構規則
防禦模式的 section 規則 SHALL 遵循答辯狀的標準結構。

#### Scenario: 段落順序
- **WHEN** 策略輸出 sections
- **THEN** 結構 SHALL 為：壹答辯聲明 → 貳前言 → 參事實及理由（逐點回應原告主張）→ 肆結論 → 伍證據方法。如有積極抗辯，放在回應段落之後、結論之前。

### Requirement: 答辯狀 writer instruction
防禦模式的 writer instruction SHALL 使用逐點反駁的語氣和句式。

#### Scenario: 內容段落語氣
- **WHEN** 撰寫答辯狀的內容段落（有 dispute_id）
- **THEN** writer instruction SHALL 引導使用「原告主張...惟查...」的反駁句式，強調引用對方證據漏洞和我方證據反駁

#### Scenario: 證據引用策略
- **WHEN** 撰寫答辯狀段落
- **THEN** writer instruction SHALL 引導 AI 不僅引用我方證據，也指出原告證據的不足或矛盾

### Requirement: Step 0 答辯狀走 reuse disputes 路徑
當書狀為防禦模式時，Step 0 SHALL 優先複用現有爭點分析。

#### Scenario: disputes 已存在
- **WHEN** 案件已有 disputes 且 `template_id` 為防禦模式
- **THEN** 跳過 orchestrator，直接使用現有 disputes、damages、timeline

#### Scenario: disputes 不存在但有對方書狀
- **WHEN** 案件無 disputes 但有 `category: 'brief'` 的檔案
- **THEN** 走完整分析流程（現有 orchestrator），prompt 引導 AI 特別注意對方書狀中的主張
