## ADDED Requirements

### Requirement: Undisputed damages block renders as independent collapsible section
The system SHALL render undisputed damages (damages with `dispute_id === null`) in a separate `UndisputedDamagesBlock` component, independent from `UndisputedFactsBlock`.

#### Scenario: Undisputed damages exist
- **WHEN** there are damages with `dispute_id === null`
- **THEN** the system renders `UndisputedDamagesBlock` below `UndisputedFactsBlock` in the disputes tab
- **AND** the block header displays: DollarSign icon + "不爭執金額" label + count badge + subtotal amount

#### Scenario: No undisputed damages
- **WHEN** all damages have a non-null `dispute_id`
- **THEN** `UndisputedDamagesBlock` SHALL NOT render (returns null)

### Requirement: Undisputed damages block displays subtotal
The system SHALL display the sum of all undisputed damage amounts in the block header, formatted with `formatAmount()`.

#### Scenario: Subtotal display
- **WHEN** undisputed damages total is NT$ 67,700
- **THEN** the header displays "NT$ 67,700" right-aligned in `text-xs text-t3`

### Requirement: Undisputed damages block supports CRUD via shared damage dialogs
The system SHALL support adding, editing, and deleting undisputed damages through the shared `DamageFormDialog` and `ConfirmDialog` in `DisputesTab`.

#### Scenario: Add undisputed damage
- **WHEN** user clicks the "+" button in the undisputed damages block header
- **THEN** the system calls `onAddDamage(null)` to open the damage form with `dispute_id = null`

#### Scenario: Edit undisputed damage
- **WHEN** user clicks the edit icon on an InlineDamageItem within the block
- **THEN** the system calls `onEditDamage(damage)` to open the damage form pre-filled

#### Scenario: Delete undisputed damage
- **WHEN** user clicks the delete icon on an InlineDamageItem within the block
- **THEN** the system calls `onDeleteDamage(damage)` to stage deletion confirmation

### Requirement: UndisputedFactsBlock no longer renders damage items
The `UndisputedFactsBlock` SHALL only render `SimpleFact` items. All damage-related props and rendering logic SHALL be removed.

#### Scenario: Facts-only rendering
- **WHEN** `UndisputedFactsBlock` renders
- **THEN** it displays only `FactCard` items and the add-new-fact textarea
- **AND** it does NOT render any `InlineDamageItem` components

### Requirement: FactCard displays checkmark icon
Each `FactCard` SHALL display a `Check` icon (lucide-react, `size-3 text-gr`) to the left of the fact text, providing visual consistency with the icon-based identification system.

#### Scenario: Fact card with icon
- **WHEN** a FactCard renders a fact description
- **THEN** a green checkmark icon appears at the left side of the text
- **AND** the card uses the unified base style `rounded bg-bg-1 px-2.5 py-1.5`

### Requirement: InlineDamageItem shows evidence refs in undisputed block
When rendered inside `UndisputedDamagesBlock`, each `InlineDamageItem` SHALL display evidence references below the basis text.

#### Scenario: Refs display in undisputed context
- **WHEN** an InlineDamageItem is rendered in `UndisputedDamagesBlock`
- **THEN** `showRefs={true}` is passed and evidence_refs are displayed as `text-xs text-t3/60`
