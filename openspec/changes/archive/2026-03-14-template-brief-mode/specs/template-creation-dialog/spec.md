## ADDED Requirements

### Requirement: 新增自訂範本 Dialog

點擊「新增自訂範本」按鈕 SHALL 開啟 Dialog，包含範本名稱輸入欄位和書狀性質 radio group。

#### Scenario: Dialog 內容
- **WHEN** 使用者點擊「新增自訂範本」按鈕
- **THEN** SHALL 顯示 Dialog，包含：(1) 範本名稱 text input（placeholder 如「民事反訴狀」）、(2) 書狀性質 radio group 五個選項、(3) 取消和建立按鈕

#### Scenario: 書狀性質選項
- **WHEN** Dialog 顯示
- **THEN** radio group SHALL 包含以下選項：「提出請求（起訴、反訴等）」、「回應對方（答辯等）」、「補充攻防（準備書狀等）」、「挑戰裁判（上訴等）」、「聲請法院（強制執行等）」

#### Scenario: 選中後顯示說明文字
- **WHEN** 使用者選中某個書狀性質選項
- **THEN** radio group 下方 SHALL 顯示對應的說明文字，描述 AI 會以何種策略撰寫

#### Scenario: 建立按鈕啟用條件
- **WHEN** 範本名稱為空或未選擇書狀性質
- **THEN** 建立按鈕 SHALL 為 disabled 狀態

#### Scenario: 成功建立
- **WHEN** 使用者填寫名稱、選擇性質並點擊建立
- **THEN** SHALL 呼叫 API 建立模板（帶 `title` 和 `brief_mode`），建立成功後關閉 Dialog 並開啟 TemplateEditor tab
