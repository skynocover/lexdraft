## ADDED Requirements

### Requirement: Reanalyze icon button in each analysis tab
Each analysis tab (爭點/金額/時間軸) SHALL display a `RefreshCw` icon button in the top-right corner when analysis data exists.

#### Scenario: Button visible when data exists
- **WHEN** disputes/damages/timeline array has items
- **THEN** a `RefreshCw` icon button SHALL appear in the tab's top-right corner

#### Scenario: Button hidden when no data
- **WHEN** disputes/damages/timeline array is empty
- **THEN** the icon button SHALL NOT be displayed

#### Scenario: Tooltip on hover
- **WHEN** user hovers over the icon button
- **THEN** a Tooltip SHALL display the action label ("重新分析爭點" / "重新計算金額" / "重新產生時間軸")

### Requirement: Loading state during analysis
The icon button SHALL indicate loading state while analysis is in progress.

#### Scenario: Loading spinner
- **WHEN** analysis API call is in progress
- **THEN** the `RefreshCw` icon SHALL have `animate-spin` class and the button SHALL be disabled

#### Scenario: Loading complete
- **WHEN** analysis API call completes (success or failure)
- **THEN** the spinner SHALL stop and the button SHALL be re-enabled

### Requirement: Confirmation dialog before reanalysis
The system SHALL show an AlertDialog before executing reanalysis when certain conditions are met.

#### Scenario: Has existing data only
- **WHEN** user clicks reanalyze button AND there is existing data AND no files are processing
- **THEN** AlertDialog SHALL show "現有的分析結果會被覆蓋。" with 取消/確認 buttons

#### Scenario: Has processing files only (empty state)
- **WHEN** user clicks analyze button AND no existing data AND files are processing
- **THEN** AlertDialog SHALL show "有 N 個檔案仍在處理中，分析結果可能不完整。是否仍要進行分析？" with 取消/繼續分析 buttons

#### Scenario: Has both existing data and processing files
- **WHEN** user clicks reanalyze button AND there is existing data AND files are processing
- **THEN** AlertDialog SHALL show combined message "有 N 個檔案仍在處理中，且現有的分析結果會被覆蓋。是否仍要進行分析？" with 取消/繼續分析 buttons

#### Scenario: Empty state without processing files
- **WHEN** user clicks analyze button from empty state AND no files are processing
- **THEN** analysis SHALL execute immediately without confirmation

### Requirement: Empty state buttons use direct API
The existing "AI 自動計算" (DamagesTab) and "AI 自動整理" (TimelineTab) empty state buttons SHALL call the new analyze API directly instead of sending chat messages. DisputesTab SHALL also have an empty state button.

#### Scenario: DamagesTab empty state button
- **WHEN** user clicks "AI 自動計算" in empty DamagesTab
- **THEN** system SHALL call `POST /api/cases/:caseId/analyze` with `{ type: 'damages' }` (not sendMessage)

#### Scenario: TimelineTab empty state button
- **WHEN** user clicks "AI 自動整理" in empty TimelineTab
- **THEN** system SHALL call `POST /api/cases/:caseId/analyze` with `{ type: 'timeline' }` (not sendMessage)

#### Scenario: DisputesTab empty state button
- **WHEN** disputes array is empty
- **THEN** an "AI 自動分析" button SHALL appear in the empty state

### Requirement: Toast notifications on completion
The system SHALL show toast notifications after analysis completes.

#### Scenario: Success toast
- **WHEN** analysis completes successfully
- **THEN** `toast.success` SHALL display with result summary (e.g., "爭點分析完成（3 個爭點）")

#### Scenario: Error toast
- **WHEN** analysis fails
- **THEN** `toast.error` SHALL display "分析失敗，請稍後再試"

### Requirement: Store methods for direct analysis
`useAnalysisStore` SHALL expose methods to call the analyze API directly.

#### Scenario: runAnalysis method
- **WHEN** `runAnalysis(caseId, 'disputes')` is called
- **THEN** it SHALL POST to `/api/cases/:caseId/analyze`, update store state with returned data, and show appropriate toast
