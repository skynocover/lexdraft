## ADDED Requirements

### Requirement: Dispute cards show sequential number prefix

DisputeCard SHALL display a sequential number prefix (爭點 1, 爭點 2, ...) before the title text, using the card's position index + 1.

#### Scenario: Collapsed dispute cards are distinguishable
- **WHEN** multiple dispute cards are rendered in collapsed state
- **THEN** each card shows "爭點 {N}：{title}" where N is its 1-based position

### Requirement: Summary bar hides zero-count status items

The disputes summary bar SHALL only render status items (充分/不足/缺漏) when their count is greater than zero.

#### Scenario: All disputes have sufficient evidence
- **WHEN** all disputes have evidence status "ok" (e.g. 6 ok, 0 warn, 0 miss)
- **THEN** summary bar shows "6 個爭點 充分 6" without "不足 0" or "缺漏 0"

#### Scenario: Mixed evidence status
- **WHEN** disputes have mixed status (e.g. 4 ok, 0 warn, 2 miss)
- **THEN** summary bar shows "6 個爭點 充分 4 缺漏 2" without "不足 0"

### Requirement: Unified expand/collapse icon

DisputeCard and DamageCard SHALL use ChevronRight icon with rotate-90 transition for expand/collapse indication, matching the CollapsibleSection pattern in RightSidebar.

#### Scenario: Card is collapsed
- **WHEN** a dispute or damage card is in collapsed state
- **THEN** the ChevronRight icon points right (no rotation)

#### Scenario: Card is expanded
- **WHEN** a dispute or damage card is in expanded state
- **THEN** the ChevronRight icon rotates 90 degrees to point downward
