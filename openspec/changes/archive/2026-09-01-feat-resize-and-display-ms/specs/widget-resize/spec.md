# Spec: widget resize (drag handle + settings control)

## Purpose

The ad widget's width is fixed at 360 px by default today, with no
client-side way to change it. Hosts that want a side-rail layout (≈240
px) or a hero card (≈600 px) have to edit the plugin config file
directly. This spec adds two user-facing controls (a SE resize handle on
the widget itself and a slider+number input in `AdSettingsCard`) and
wires them to the same `widget.size` setting the host already supports
via `setDisplay` and the settings transport.

## ADDED Requirements

### Requirement: SE handle is always available and pointer-dedicated

The widget shell SHALL render a dedicated SE corner handle as a
direct child of the widget root. The handle SHALL be a `button`-like
element with `role="button"` and an accessible label in every
supported locale (`ad.widget.resizeHint`).

Pointer-down on the handle SHALL NOT trigger the widget's drag gesture.
Pointer-down anywhere else on the widget shell SHALL NOT trigger a
resize. The two gestures are mutually exclusive by element target, not
by timing.

#### Scenario: handle is focusable and labelled

- **WHEN** the widget shell is rendered with `display.visible === true`
  AND `display.enabled === true`
- **THEN** the handle element exists in the DOM with
  `role="button"`, a non-empty `aria-label`, and is reachable by
  `Tab` keyboard focus.

#### Scenario: handle press does not start a drag

- **WHEN** the user presses the handle (`pointerdown` on the handle
  element)
- **THEN** the widget's `dragRef` SHALL remain `null` for the
  duration of the press
- **AND** the handle's `resizeRef` SHALL be populated.

#### Scenario: shell press does not start a resize

- **WHEN** the user presses the widget shell (any descendant of the
  root that is not the handle and not a button/select/input)
- **THEN** the handle's `resizeRef` SHALL remain `null`
- **AND** the widget's `dragRef` SHALL be populated.

### Requirement: Resize gesture updates size in real time

While the user holds and moves the handle, the widget's rendered width
SHALL follow the cursor 1:1 (clamped to `MIN_WIDGET_SIZE..MAX_WIDGET_SIZE`,
default 200..800 px). The widget SHALL NOT update the host-controlled
`widget.size` on every pointermove — only the local rendering
snapshot. The committed value is sent on `pointerup` exactly once,
through `POST /api/ad/display { size: N }`.

#### Scenario: cursor move is reflected without a host round-trip

- **WHEN** the user holds the handle and moves the cursor 80 px to
  the right
- **THEN** the widget's rendered width SHALL grow by 80 px (or be
  clamped to `MAX_WIDGET_SIZE` if the result exceeds it)
- **AND** no `POST /api/ad/display` request SHALL be sent until
  `pointerup`.

#### Scenario: pointerup commits exactly one POST

- **WHEN** the user releases the handle
- **THEN** exactly one `POST /api/ad/display` request SHALL be sent
  with the clamped final size in the `size` field.

### Requirement: Settings control round-trips with the handle

`AdSettingsCard` SHALL expose a slider and a numeric input bound to
`widget.size`. Editing either control SHALL:
1. Update the live widget width immediately (optimistic).
2. Persist through the same settings transport the other widget
   controls use today (so the persistence path is identical).
3. NOT trigger a resize gesture (the slider is keyboard/mouse, not
   a pointer-capture handler).

#### Scenario: slider move updates live widget

- **WHEN** the user moves the size slider from 360 to 500
- **THEN** the widget's rendered width SHALL become 500 px without
  a page reload
- **AND** the slider's value SHALL be committed to settings
  transport.

#### Scenario: numeric input and slider stay in sync

- **WHEN** the user types `420` in the numeric input
- **THEN** the slider's thumb position SHALL reflect 420
- **AND** the handle's underlying `display.size` SHALL be 420
  (rounded to the slider's step, 10).

### Requirement: Persistence survives reload

The committed size SHALL be read back by `fetchDisplay` on the next
poll and applied to the widget without snap-back, matching the
existing behavior for `widget.right` / `widget.bottom`.

#### Scenario: size survives a hard reload

- **GIVEN** the widget is currently 500 px wide
- **WHEN** the user reloads the page
- **THEN** the widget SHALL render at 500 px on first paint
- **AND** the settings card slider SHALL show 500.

### Requirement: Cursor reflects state

- Idle (no gesture): `cursor: grab` on the widget shell,
  `cursor: se-resize` on the handle.
- Drag in progress: `cursor: grabbing` on the shell (unchanged).
- Resize in progress: `cursor: nwse-resize` on the handle.

#### Scenario: cursor styles match gesture state

- **WHEN** no gesture is active
- **THEN** the widget shell's `cursor` computed style is `grab`
  and the handle's is `se-resize`.
- **WHEN** the user holds the handle and moves the cursor
- **THEN** the handle's `cursor` computed style becomes `nwse-resize`.

### Requirement: Settings schema is unchanged

No new fields on `AdWidgetSettings`. The existing
`size: z.number().min(200).max(800).default(360)` field carries the
resize value. Existing settings documents migrate without edits.

#### Scenario: existing settings payloads still validate

- **WHEN** a previously-saved settings document (without any new
  fields) is loaded
- **THEN** the schema validation SHALL pass without migration
  prompts.
