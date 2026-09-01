# Spec: per-source `displayMs` with video-duration awareness

## Purpose

Auto-rotation today is a single global 15 000 ms timer. A 5-second
video creative gets ten seconds of dead air after the clip ends; a
30-second product video gets cut off mid-engagement. Per-source
`displayMs` (defaulting to 15 000 ms) restores per-source pacing, and
for video items the actual `video.duration` becomes a clamped dynamic
input so the rotation timer tracks the creative instead of fighting it.

## ADDED Requirements

### Requirement: `displayMs` is a validated `AdSourceConfig` field

`AdSourceConfig` SHALL accept an optional `displayMs: number` field
with bounds 1 000..600 000. Absent → default 15 000. The validator
SHALL reject out-of-range values with a clear error message that
includes the offending source id and the value received.

The companion fields `minVideoMs` (default 4 000) and `maxVideoMs`
(default 120 000) SHALL follow the same validation pattern and
default-to-the-documented-value-on-absence rule.

#### Scenario: omitted fields use defaults

- **WHEN** a source config is loaded with no `displayMs`,
  `minVideoMs`, or `maxVideoMs` keys
- **THEN** the runtime values SHALL be `15000`, `4000`, `120000`
  respectively.

#### Scenario: out-of-range displayMs is rejected

- **WHEN** a source config declares `displayMs: 500`
- **THEN** the loader SHALL throw a validation error naming the
  source id and the offending value.

#### Scenario: inverted min/max is rejected

- **WHEN** a source config declares `minVideoMs: 10000` and
  `maxVideoMs: 5000`
- **THEN** the loader SHALL throw a validation error explaining
  that `minVideoMs` cannot exceed `maxVideoMs`.

### Requirement: `displayMs` is computed server-side per item

`AdService.nextItem` (or its caller in `/api/ad/next`) SHALL compute
the effective display time for the just-returned item and return it as
`displayMs` in the response payload:

- For items with `type === 'video'`: `displayMs = source.displayMs`
  initially (the server does not have access to `<video>.duration`).
  The browser refines to
  `clamp(videoDurationMs, minVideoMs, maxVideoMs)` on
  `loadedmetadata`.
- For all other items: `displayMs = source.displayMs ?? 15 000`.

The server SHALL NOT trust a client-supplied `displayMs`. The value
SHALL be derived from the source config and (for video) the item's
own `mediaUrl` resolution path. The browser receives a number, not
a formula.

#### Scenario: non-video response carries source default

- **WHEN** `POST /api/ad/next` is called for a non-video source
  with `displayMs: 5000`
- **THEN** the response SHALL include `displayMs: 5000`.

#### Scenario: video response carries source default, not the duration

- **WHEN** `POST /api/ad/next` is called for a video source with
  `displayMs: 15000`
- **THEN** the response SHALL include `displayMs: 15000` (the
  source default), NOT a video-duration-derived value — the
  server has no `<video>` element.

### Requirement: `videoDurationMs` fallback while metadata loads

For video items, the browser does not have `video.duration` until the
`<video>` element fires `loadedmetadata`. The widget SHALL use the
source's `displayMs` (default 15 000) as the initial rotation
timeout, and on `loadedmetadata` it SHALL re-derive the effective
timeout as
`clamp(duration * 1000, minVideoMs, maxVideoMs)` and reschedule the
pending timer.

If the `<video>` fails to load metadata (network error, autoplay
block, unsupported codec) within 30 s, the widget SHALL fall back to
`source.displayMs` and continue rotating on that timer.

#### Scenario: 7 s video rotates after 7 s with defaults

- **GIVEN** a video source with default `minVideoMs: 4000`,
  `maxVideoMs: 120000`, `displayMs: 15000`
- **WHEN** the widget renders an item with `<video>.duration === 7`
- **THEN** the rotation timer SHALL be set to 7 000 ms.

#### Scenario: very long video is clamped to maxVideoMs

- **GIVEN** a video source with `maxVideoMs: 60000`
- **WHEN** the widget renders an item with `<video>.duration === 90`
- **THEN** the rotation timer SHALL be set to 60 000 ms.

#### Scenario: failed metadata falls back to displayMs

- **WHEN** the `<video>` element fires `error` before `loadedmetadata`
- **THEN** the rotation timer SHALL be the source's `displayMs`
  (default 15 000), and rotation SHALL continue.

### Requirement: Manual prev/next resets the timer

Calling `goRelative(±1)` SHALL cancel any pending rotation timer and
schedule a new one keyed off the new item's computed `displayMs`.
This guarantees the next item's natural duration applies, not the
previous item's leftover.

#### Scenario: nav click resets the timer

- **GIVEN** the rotation timer has 3 s remaining on item A
- **WHEN** the user clicks the `›` button
- **THEN** the pending timer SHALL be cancelled
- **AND** a new timer SHALL be scheduled for the full
  `displayMs` of the new item.

### Requirement: Host `widget.rotationMs` fallback still wins for non-sources

The existing `display.rotationMs` override (set from `AdSettingsCard`)
SHALL continue to act as a per-deployment fallback for sources that
omit `displayMs`. The order of precedence in the widget is:

1. Server-computed `displayMs` for the current item (if the host
   sets the field on the source).
2. `display.rotationMs` from settings.
3. `WIDGET_ROTATION_MS` client constant (15 000 ms).

#### Scenario: precedence order is source → settings → default

- **GIVEN** item `displayMs: 5000` AND `display.rotationMs: 30000`
- **WHEN** the widget starts a rotation
- **THEN** the effective timeout SHALL be 5 000 ms (item wins).

- **GIVEN** item `displayMs` undefined AND `display.rotationMs: 30000`
- **THEN** the effective timeout SHALL be 30 000 ms (settings wins).

- **GIVEN** item `displayMs` undefined AND no settings override
- **THEN** the effective timeout SHALL be 15 000 ms
  (`WIDGET_ROTATION_MS`).

### Requirement: API contract is additive-only

`POST /api/ad/next` response gains `displayMs: number`. No existing
fields are removed or renamed. Clients that ignore the new field
continue to work (the old `WIDGET_ROTATION_MS` default applies if
the client doesn't read the field).

#### Scenario: legacy client continues to function

- **WHEN** an old client (built before this change) calls
  `POST /api/ad/next` and ignores the new `displayMs` field
- **THEN** the request SHALL succeed identically to pre-change
  behavior; the widget SHALL rotate on the `WIDGET_ROTATION_MS`
  constant.

### Requirement: `AdItemView` exposes the server-computed `displayMs`

The client-side `AdItemView` type adds an optional `displayMs?: number`
field. It is populated by the widget on each `/api/ad/next` response
and consumed by the rotation effect.

#### Scenario: type definition includes the new field

- **WHEN** the widget reads the response from `/api/ad/next`
- **THEN** the item's `displayMs` field is `number | undefined`
  (optional, additive)
- **AND** existing fields SHALL keep their pre-change shape.
