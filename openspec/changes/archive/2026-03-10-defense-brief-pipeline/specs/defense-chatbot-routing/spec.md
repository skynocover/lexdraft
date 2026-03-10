## ADDED Requirements

### Requirement: AgentDO 根據用戶意圖自動選擇 template
AgentDO system prompt SHALL 引導 AI 根據用戶的書狀撰寫請求自動選擇正確的 `template_id`。

#### Scenario: 明確要求答辯狀
- **WHEN** 用戶說「幫我寫答辯狀」或包含「答辯」關鍵字
- **THEN** AgentDO SHALL 呼叫 `write_full_brief` 時使用 `template_id: 'default-civil-defense'`

#### Scenario: 明確要求準備書狀
- **WHEN** 用戶說「幫我寫準備書狀」或包含「準備書狀」關鍵字
- **THEN** AgentDO SHALL 呼叫 `write_full_brief` 時使用 `template_id: 'default-civil-preparation'`

#### Scenario: 模糊要求寫書狀
- **WHEN** 用戶說「幫我寫書狀」但未指定類型
- **THEN** AgentDO SHALL 根據 `client_role` 和案件已有書狀推斷最可能的類型，並用一句話向用戶確認後再執行

#### Scenario: 被告方無書狀時的預設推斷
- **WHEN** `client_role` 為 defendant 且案件無書狀，用戶模糊要求寫書狀
- **THEN** AgentDO SHALL 建議撰寫答辯狀

#### Scenario: 已有答辯狀時的推斷
- **WHEN** 案件已有答辯狀，用戶模糊要求寫書狀
- **THEN** AgentDO SHALL 建議撰寫準備書狀
