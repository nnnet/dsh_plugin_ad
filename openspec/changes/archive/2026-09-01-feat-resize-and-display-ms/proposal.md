# feat: widget resize (drag + settings) & per-source displayMs with video-duration awareness

## Why

The widget is a fixed width today (`size` exists in the schema and on
`AdSettings` but is never editable from the settings card; the only path
to change it is editing the plugin config file). That makes it awkward
to adapt the widget to a side-rail layout vs. a centered product card
on the same host.

Auto-rotation is also fixed at 15 s (`WIDGET_ROTATION_MS`). For a video
creative that's 5 s long we waste 10 s of attention; for a 30 s video we
cut off before the user has a chance to engage. Per-source display time,
with video duration as a dynamic input, lets each source keep its own
pacing without manual config tuning for every new clip.

## What changes

### 1. Resizable widget

- Add a bottom-right (SE) resize handle inside the widget shell. Pointer
  events on the handle do not start a drag — they start a resize.
- Resize updates a local `resizePx` state for smooth 1:1 follow; on
  pointerup, commit through the existing `/api/ad/display` route (the
  host already supports `size` in `setDisplay`).
- Persist the chosen size; survives reload.
- In `AdSettingsCard`, expose a slider + numeric input bound to
  `widget.size` (200..800 px, matching the existing schema). Slider and
  handle stay in sync (handle updates slider; slider updates handle).
- Press on the handle stops pointerdown from bubbling to the widget, so
  drag and resize never both fire on the same gesture.
- CSS: `cursor: se-resize` on the handle, `cursor: nwse-resize` while
  active. The widget root keeps `cursor: grab/grabbing`.

### 2. Per-source displayMs (video-aware)

- New optional `displayMs` on `AdSourceConfig` (default 15 000). Lower
  bound 1 000, upper bound 600 000 (matches the existing `rotationMs`
  validation on the widget side, so users can override per-source without
  a second mental model).
- For `video` items, the effective display time is
  `clamp(videoDurationMs, minVideoMs, maxVideoMs)`. The source
  additionally accepts `minVideoMs` / `maxVideoMs` overrides
  (default 4 000..120 000 — wide enough for typical ads, narrow enough
  to bound the timer).
- For non-video items, the effective display time is the raw
  `displayMs` value.
- `/api/ad/next` response adds `displayMs: number` (the computed value
  for the just-returned item), so the client doesn't have to re-derive.
- The widget's auto-rotation `setInterval` becomes a `setTimeout`
  chained off the current item's `displayMs`. Manual prev/next
  immediately resets the timer.
- If the host overrides the widget's existing `rotationMs`, that
  remains the per-source-agnostic fallback. `displayMs` wins when set.

## Non-goals

- Height resize (the schema only models width; keep it that way).
- Persisted height-per-content. The shell still auto-sizes to its
  creative.
- A "global" per-app `displayMs` — sources stay independent.
- Min/max `displayMs` exposed on the wire; they're config-only.
- Persisting `displayMs` to `AdSettings` (it's a source field, not a
  widget field).

## Acceptance criteria

A1. Dragging the SE handle changes widget width in real time and the
    committed `widget.size` value is observable via
    `POST /api/ad/display { size: N }` and persists across page reload.

A2. `AdSettingsCard` shows a slider + numeric input for size. Both
    write `widget.size` through the same settings transport the toggle
    controls use today. Changes round-trip through the live widget
    immediately (no reload).

A3. Pressing on the SE handle does NOT start a drag gesture (cursor
    stays at the handle, no widget translate); pressing elsewhere on
    the widget shell does NOT start a resize (cursor stays as
    `grab`/`grabbing`).

A4. `AdSourceConfig.displayMs` validates as 1000..600000; absent falls
    back to 15000.

A5. `POST /api/ad/next` response includes a `displayMs` field equal
    to `clamp(videoDurationMs, minVideoMs, maxVideoMs)` for video
    items, or to the raw `displayMs` for everything else.

A6. With `displayMs: 5000`, non-video items rotate every 5 s. With a
    7 s video and defaults, the widget waits the full 7 s
    (`clamp(7000, 4000, 120000) = 7000`) before advancing.

A7. Manual prev/next calls reset the rotation timer; the next item
    rotates after its own computed `displayMs`, not the previous
    item's.

## Risks

- **Resize vs drag pointer-target collision.** The current widget uses
  pointer capture on `e.target`; capture on the handle element means a
  press on the handle never reaches the widget's `onPointerDown`.
  Verifying via tests is mandatory (see tasks).
- **Resizing the widget while it's in the middle of an auto-rotation
  timer swap.** The timer is decoupled from size, so a size change
  cannot shorten the current item's display; only a manual step
  advances early. This is the desired behavior — we don't cut a video
  short because the user resized the chrome.
- **`<video>` `duration` is `NaN` until `loadedmetadata`.** The widget
  must not show a 0-ms or NaN-ms timer. Tasks include a fallback path
  that uses the source's `displayMs` until metadata loads, then swaps
  to the clamped duration.
- **Setting `displayMs` to less than 4 000 with a 10 s video means
  the user sees the first 4 s and then a jump.** Documented via
  `minVideoMs` in the config; no runtime warning is added (it would
  be noisy and the user is in control).
