## Context

Pipeline 目前用 `isDefenseTemplate(templateId)` 硬編碼比對 `'default-civil-defense'` 和 `'default-civil-preparation'` 來選擇攻擊/防禦 prompt。這個二元分類無法涵蓋台灣民事書狀的五種論述模式，且準備書狀被永遠歸為防禦是一個 bug（原告也會寫準備書狀）。

現有架構：
- `DefaultTemplate` 介面（`defaultTemplates.ts`）：`id`, `title`, `category`, `agentHint`, `content_md`
- DB `templates` 表：`id`, `title`, `category`, `content_md`, `is_default`
- Pipeline 路由：`isDefenseTemplate()` → `getClaimsRules()` / `getSectionRules()` / `getJsonSchema()`
- 前端：`useTemplateStore` → `createTemplate(title?)` → 直接建立，無 Dialog

## Goals / Non-Goals

**Goals:**
- Template 自帶 `brief_mode` 屬性，pipeline 根據屬性選擇 prompt 組合
- 五種模式：`claim`、`defense`、`challenge`、`supplement`、`petition`
- 自訂模板建立時強制選擇書狀性質，建後可在 TemplateEditor 修改
- 消除 `isDefenseTemplate()` 硬編碼

**Non-Goals:**
- 不為 `challenge`、`supplement`、`petition` 撰寫專屬 prompt（Phase 2）
- 不處理模板繼承或複製功能
- 不修改 AI 自動選擇模板（`template_id: 'auto'`）的邏輯

## Decisions

### D1: `brief_mode` 值域設計

五種模式對應台灣民事書狀的實際分類：

| brief_mode | 語義 | Pipeline 行為（Phase 1） |
|------------|------|------------------------|
| `claim` | 提出請求 | 使用現有攻擊 prompt |
| `defense` | 回應對方 | 使用現有防禦 prompt |
| `challenge` | 挑戰裁判 | fallback → `claim` prompt |
| `supplement` | 補充攻防 | 看 `client_role`：defendant → `defense`，其餘 → `claim` |
| `petition` | 聲請法院 | fallback → `claim` prompt |

**替代方案**：只用 `claim`/`defense` 二元。排除原因：上訴狀和強制執行聲請狀在語義上不是「主張」也不是「防禦」，未來需要專屬 prompt，二元分類無法擴充。

### D2: 預設模板對應

| Template ID | brief_mode |
|-------------|-----------|
| `default-civil-complaint` | `claim` |
| `default-civil-complaint-damages` | `claim` |
| `default-civil-defense` | `defense` |
| `default-civil-preparation` | `supplement` |
| `default-civil-appeal` | `challenge` |
| `default-enforcement` | `petition` |

### D3: Pipeline 路由重構

移除 `isDefenseTemplate()`，改為 `resolvePipelineMode()` 函式：

```
resolvePipelineMode(briefMode, clientRole) → 'claim' | 'defense'
```

- `claim` / `challenge` / `petition` → `'claim'`
- `defense` → `'defense'`
- `supplement` → `clientRole === 'defendant' ? 'defense' : 'claim'`

所有現有的 `getClaimsRules(templateId)`、`getSectionRules(templateId)`、`getJsonSchema(templateId)` 改為接收 `pipelineMode: 'claim' | 'defense'` 參數。

### D4: `briefMode` 來源 — 系統模板 vs 自訂模板 vs DB

系統預設模板的 `briefMode` 定義在 `defaultTemplates.ts`（code-level），不存 DB。自訂模板的 `brief_mode` 存 DB `templates` 表。Pipeline 取得 `briefMode` 的優先順序：

1. 若 `templateId` 匹配系統預設模板 → 從 `defaultTemplates.ts` 讀 `briefMode`
2. 若為自訂模板 → 從 DB `templates.brief_mode` 讀取
3. 皆無 → fallback `'claim'`

### D5: 新增自訂範本 Dialog

取代現有的「一鍵建立」，改為 Dialog 包含：
- 範本名稱（text input）
- 書狀性質（radio group，5 個選項）
- 選中某選項時下方顯示一行說明文字（非 tooltip）
- 「建立」按鈕（名稱和性質皆填才可按）

說明文字對應：
| 選項 | 說明 |
|------|------|
| 提出請求 | AI 會以主動建立請求權基礎的策略撰寫此書狀 |
| 回應對方 | AI 會以逐點反駁對方主張的策略撰寫此書狀 |
| 補充攻防 | AI 會根據案件立場，以回應前一輪攻防的策略撰寫此書狀 |
| 挑戰裁判 | AI 會以指出原判決錯誤的策略撰寫此書狀 |
| 聲請法院 | AI 會以陳述事實並聲請裁定的策略撰寫此書狀 |

### D6: TemplateEditor 工具列

自訂模板的工具列新增一個 `Select` 元件，顯示當前 `briefMode`，可切換。改了後觸發 auto-save。系統預設模板不顯示（唯讀，性質固定）。

## Risks / Trade-offs

- **[Phase 1 行為不完整]** `challenge`、`supplement`、`petition` 的 fallback prompt 不是最佳結果，但比現在準備書狀永遠防禦要好 → 未來 Phase 2 補專屬 prompt
- **[刪除現有自訂模板]** Migration 會刪除所有 `is_default=0` 的 templates → 確認尚未上線，無資料損失風險
- **[briefMode 選錯]** 律師選錯性質會導致 AI 用錯策略 → TemplateEditor 工具列可修改，且 Dialog 的選項描述和說明文字已足夠清楚
