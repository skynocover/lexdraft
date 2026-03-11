## ADDED Requirements

### Requirement: 展開後顯示雙方立場
DisputeCard 展開後 SHALL 在最頂部顯示我方立場（`our_position`）和對方立場（`their_position`），使用左色條區分（我方藍色、對方橘色）。

#### Scenario: 有雙方立場
- **WHEN** 爭點的 `our_position` 和 `their_position` 都有值
- **THEN** 展開區頂部顯示兩個立場區塊，我方在上、對方在下

#### Scenario: 只有我方立場
- **WHEN** 爭點只有 `our_position` 有值，`their_position` 為空
- **THEN** 只顯示我方立場區塊

#### Scenario: 雙方立場都為空
- **WHEN** `our_position` 和 `their_position` 都為空或 null
- **THEN** 不渲染立場區塊

#### Scenario: 長文字截斷
- **WHEN** 立場文字超過 3 行
- **THEN** 顯示前 3 行並截斷，hover 時顯示完整文字

### Requirement: 事實爭議預設收合
有 facts 時 SHALL 顯示「事實爭議 (N)」收合區塊，預設收合。

#### Scenario: 有 facts
- **WHEN** 爭點有 `facts`（`facts.length > 0`）
- **THEN** 在證據/法條 tags 下方顯示「▸ 事實爭議 (N)」，點擊展開

#### Scenario: 無 facts
- **WHEN** 爭點沒有 facts
- **THEN** 不顯示事實爭議區塊

### Requirement: FactList 簡化
展開的 FactList SHALL 只顯示 assertion_type badge 和描述文字，不顯示 per-fact 的檔案引用。

#### Scenario: 一般 fact
- **WHEN** 事實爭議展開
- **THEN** 每個 fact 只顯示 badge（承認/爭執/推定等）+ 描述文字，不顯示檔案名和來源

#### Scenario: 有爭議的 fact
- **WHEN** fact 有 `disputed_by` 值
- **THEN** 在描述文字下方顯示橘色爭議提示

### Requirement: 移除跳到段落按鈕
DisputeCard SHALL 不再顯示「跳到段落 →」按鈕。

#### Scenario: 展開爭點卡片
- **WHEN** 使用者展開任一爭點卡片
- **THEN** 展開區不包含「跳到段落」連結

## REMOVED Requirements

### ~~Requirement: 攻防主張預設收合~~
**已移除** — Claims 是 pipeline Step 2 的書狀級產物（`assigned_section` 綁定書狀段落），不屬於案件級的爭點分析。DisputesTab SHALL NOT 顯示 claims。

## ADDED Requirements (Backend)

### Requirement: Facts 持久化
分析產出的 facts SHALL 持久化到 DB，頁面重載後不遺失。

#### Scenario: 深度分析完成
- **WHEN** `persistDisputes` 儲存爭點資料
- **THEN** `facts` 以 JSON 字串存入 `disputes.facts` 欄位

#### Scenario: 頁面重載
- **WHEN** 前端呼叫 GET `/cases/:caseId/disputes`
- **THEN** 每個 dispute 包含 parsed `facts` 陣列

#### Scenario: 舊資料無 facts
- **WHEN** dispute 的 `facts` 欄位為 null（migration 前的資料）
- **THEN** 回傳空陣列，前端不顯示事實爭議區塊

### Requirement: 重新分析爭點不影響 claims
`persistDisputes` SHALL NOT 刪除 claims 資料。

#### Scenario: 手動重新分析爭點
- **WHEN** 使用者點擊重新分析爭點
- **THEN** 只更新 disputes 和 facts，claims 資料不受影響
