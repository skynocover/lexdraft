## ADDED Requirements

### Requirement: 爭點為頂層 sidebar tab
右側 sidebar 的頂層 tab SHALL 包含「爭點」作為獨立 tab，與「案件資訊」和「卷宗」同級。不再有「分析」tab 和 sub-tab 系統。

#### Scenario: Tab 顯示與切換
- **WHEN** 使用者開啟右側 sidebar
- **THEN** 頂層 tab 顯示 [案件資訊] [爭點] [卷宗]，點擊「爭點」tab 直接顯示爭點列表

#### Scenario: 預設 tab
- **WHEN** sidebar 首次開啟
- **THEN** 預設顯示「爭點」tab（若有爭點資料）

### Requirement: 爭點卡片摺疊狀態顯示金額
每個 DisputeCard 在摺疊狀態 SHALL 在 header 區域顯示該爭點關聯的金額小計。

#### Scenario: 有關聯金額
- **WHEN** 爭點有 1 筆以上 `dispute_id` 匹配的 damages
- **THEN** header 顯示金額小計（如 `NT$ 523,000`），與證據/法條 badge 並列

#### Scenario: 無關聯金額
- **WHEN** 爭點沒有任何關聯的 damages
- **THEN** header 不顯示金額資訊（不顯示 NT$ 0）

### Requirement: 爭點卡片展開顯示金額明細
DisputeCard 展開狀態 SHALL 在論證區塊下方顯示金額明細列表。

#### Scenario: 展開看明細
- **WHEN** 使用者展開一個有關聯金額的爭點卡片
- **THEN** 在我方/對方論證下方顯示「請求金額」區塊，列出每筆金額的描述和數字

#### Scenario: 金額項目展開
- **WHEN** 使用者點擊金額明細中的某一筆
- **THEN** 展開顯示該筆金額的 basis（計算依據）

### Requirement: 爭點內金額 CRUD
使用者 SHALL 能在爭點卡片展開狀態下對金額進行新增、編輯、刪除。

#### Scenario: 新增金額
- **WHEN** 使用者在爭點卡片的金額區塊點擊「＋」按鈕
- **THEN** 開啟 DamageFormDialog，`dispute_id` 自動帶入該爭點 ID

#### Scenario: 編輯金額
- **WHEN** 使用者 hover 金額項目並點擊編輯 icon
- **THEN** 開啟 DamageFormDialog 並帶入該金額的現有資料

#### Scenario: 刪除金額
- **WHEN** 使用者 hover 金額項目並點擊刪除 icon
- **THEN** 顯示確認 dialog，確認後刪除該金額項目

### Requirement: 未分類金額區塊
`dispute_id` 為 null 的金額 SHALL 顯示在爭點列表底部的獨立摺疊區塊。

#### Scenario: 有未分類金額
- **WHEN** 存在 `dispute_id = null` 的 damages
- **THEN** 爭點列表底部顯示「未分類金額」摺疊區塊，badge 顯示數量

#### Scenario: 未分類金額 CRUD
- **WHEN** 使用者在未分類區塊新增金額
- **THEN** 該金額的 `dispute_id` 為 null

### Requirement: 請求總額 sticky bar
爭點 tab 底部 SHALL 顯示所有金額的合計（含已分類 + 未分類）。

#### Scenario: 顯示總額
- **WHEN** 有任何 damages 資料
- **THEN** 底部 sticky bar 顯示「請求總額 NT$ X,XXX,XXX」

#### Scenario: 無金額資料
- **WHEN** 沒有任何 damages
- **THEN** 不顯示 sticky bar

### Requirement: 時間軸摺疊區塊
時間軸 SHALL 作為摺疊區塊顯示在爭點 tab 底部（請求總額上方）。

#### Scenario: 時間軸存在
- **WHEN** 有時間軸資料
- **THEN** 爭點列表底部顯示「時間軸」摺疊區塊，badge 顯示事件數量，展開後顯示完整時間軸

#### Scenario: 預設摺疊
- **WHEN** 爭點 tab 載入
- **THEN** 時間軸區塊預設為摺疊狀態

### Requirement: 前端 Damage type 包含 dispute_id
前端 `Damage` interface SHALL 包含 `dispute_id: string | null` 欄位。

#### Scenario: API 回傳 dispute_id
- **WHEN** 前端載入 damages 資料
- **THEN** 每筆 damage 的 `dispute_id` 欄位可用於按爭點分組
