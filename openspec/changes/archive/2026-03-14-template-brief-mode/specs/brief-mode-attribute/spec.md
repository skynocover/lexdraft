## ADDED Requirements

### Requirement: Template briefMode 屬性

每個 Template（系統預設和自訂）SHALL 具有 `brief_mode` 屬性，值為 `claim | defense | challenge | supplement | petition` 其中之一。系統預設模板的 `brief_mode` 定義在 `defaultTemplates.ts`，自訂模板的 `brief_mode` 存於 DB `templates.brief_mode` 欄位。

#### Scenario: 系統預設模板具有正確的 briefMode
- **WHEN** pipeline 讀取系統預設模板
- **THEN** 各模板的 `brief_mode` SHALL 為：`default-civil-complaint` → `claim`、`default-civil-complaint-damages` → `claim`、`default-civil-defense` → `defense`、`default-civil-preparation` → `supplement`、`default-civil-appeal` → `challenge`、`default-enforcement` → `petition`

#### Scenario: 自訂模板從 DB 讀取 briefMode
- **WHEN** pipeline 讀取自訂模板（`is_default=0`）
- **THEN** SHALL 從 DB `templates.brief_mode` 欄位讀取值

#### Scenario: 無 briefMode 時 fallback
- **WHEN** template 的 `brief_mode` 為 null 或不存在
- **THEN** pipeline SHALL fallback 為 `claim`

### Requirement: Pipeline 根據 briefMode 選擇 prompt 組合

Pipeline SHALL 根據 `brief_mode` 和 `client_role` 解析為 `pipelineMode`（`'claim' | 'defense'`），並據此選擇 claims rules、section rules、JSON schema、writer rules。

#### Scenario: claim 模式
- **WHEN** `brief_mode` 為 `claim`
- **THEN** pipeline SHALL 使用攻擊模式的 `CLAIMS_RULES`、`SECTION_RULES`、`STRATEGY_JSON_SCHEMA`

#### Scenario: defense 模式
- **WHEN** `brief_mode` 為 `defense`
- **THEN** pipeline SHALL 使用防禦模式的 `DEFENSE_CLAIMS_RULES`、`DEFENSE_SECTION_RULES`、`DEFENSE_JSON_SCHEMA`、`DEFENSE_WRITING_RULES`

#### Scenario: supplement 模式 — 被告案件
- **WHEN** `brief_mode` 為 `supplement` 且 `client_role` 為 `defendant`
- **THEN** pipeline SHALL 使用防禦模式 prompt

#### Scenario: supplement 模式 — 原告案件
- **WHEN** `brief_mode` 為 `supplement` 且 `client_role` 為 `plaintiff`（或未設定）
- **THEN** pipeline SHALL 使用攻擊模式 prompt

#### Scenario: challenge 和 petition fallback
- **WHEN** `brief_mode` 為 `challenge` 或 `petition`
- **THEN** pipeline SHALL fallback 使用攻擊模式 prompt（Phase 1）

### Requirement: 移除 isDefenseTemplate 硬編碼

`isDefenseTemplate()` 函式及所有呼叫點 SHALL 被移除，改為 `resolvePipelineMode(briefMode, clientRole)` 函式。

#### Scenario: 移除後 pipeline 行為不變（claim/defense）
- **WHEN** 使用 `default-civil-complaint` 或 `default-civil-defense` 模板
- **THEN** pipeline 產出的 prompt 組合 SHALL 與移除前完全相同

### Requirement: DB Migration

Migration SHALL 在 `templates` 表新增 `brief_mode` text 欄位，並刪除所有 `is_default=0` 的自訂模板。

#### Scenario: Migration 執行
- **WHEN** 執行 DB migration
- **THEN** `templates` 表 SHALL 新增 `brief_mode` 欄位（nullable text），且所有 `is_default=0` 的記錄 SHALL 被刪除
