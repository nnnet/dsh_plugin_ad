# Fix jumpy drag + add prev/next buttons

## Context

The user reports two issues after the previous round of fixes:

1. **Drag is "very rough with huge jumps."** Investigation:
   `AdWidget.tsx:245-263` mutates the `drag` ref on every mousemove:
   ```ts
   drag.right = nextRight
   drag.bottom = nextBottom
   setDisplay(prev => ({ ...prev, right: nextRight, bottom: nextBottom }))
   ```
   Then on the next move, `dx = e.clientX - drag.startX` is the cumulative
   delta from the original press, but `nextRight = drag.right - dx` uses
   the *already-mutated* `drag.right` as the base. So each frame, the
   widget jumps to `prev_position - cumulative_dx_from_start`, which is
   the correct endpoint of the *current frame's* drag — except `dx` is
   the cumulative-from-start delta, and `drag.right` was set to
   `prev_right - prev_cumulative_dx` on the previous frame, so the
   subtraction `drag.right - dx` produces a wildly different number than
   `original_start_right - dx`. Net effect: the widget lags behind the
   cursor and then snaps forward on the next move. The user sees this
   as "jumps" / "very rough" dragging.

2. **No way to set the rotation interval (per-card display time) and no
   way to manually flip cards.** `WIDGET_ROTATION_MS` lives in
   `src/client/constants.ts:13` as a hard-coded `15_000` ms. There is no
   UI to change it, and the user can't manually go to next/previous
   item without waiting up to 15s.

## Goal

- Drag is smooth: the widget follows the cursor 1:1 with no lag or
  jump on each frame.
- A "next" / "previous" pair of round buttons appears on the widget
  (left/right edges, like a carousel), lets the user flip cards
  immediately, and works for both video and marketplace sources.
- The rotation interval is exposed in `AdSettingsCard` with a
  numeric input, persisted via the existing `/api/ad/display` channel
  (it lives on `DisplayView.rotationMs`). The widget's rotation
  interval uses the per-user setting; falls back to the current
  `WIDGET_ROTATION_MS` default when unset.

## Plan

### 1. `src/client/AdWidget.tsx` — fix the jumpy drag

Stop mutating `drag.right` / `drag.bottom`. Keep `drag` as the
immutable start-of-drag snapshot; compute the new position from
`startX/Y` and the current `e.clientX/Y` on every frame.

```ts
const onMove = (e: MouseEvent): void => {
  const drag = dragRef.current
  if (drag === null) return
  const dx = e.clientX - drag.startX
  const dy = e.clientY - drag.startY
  if (!draggedRef.current && (Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX)) {
    draggedRef.current = true
  }
  if (!draggedRef.current) return
  const widgetEl = widgetRef.current
  if (widgetEl === null) return
  const width = widgetEl.offsetWidth || 240
  const height = widgetEl.offsetHeight || 240
  const nextRight = clampPx(drag.startRight - dx, 0, Math.max(0, window.innerWidth - width))
  const nextBottom = clampPx(drag.startBottom - dy, 0, Math.max(0, window.innerHeight - height))
  setDisplay(prev => ({ ...prev, right: nextRight, bottom: nextBottom }))
}
```

Also rename the ref fields to make the invariant explicit: `startX`,
`startY`, `startRight`, `startBottom` (immutable for the duration of
the press). The `onUp` handler reads the **last** display state to
persist, not the ref.

### 2. `src/client/AdWidget.tsx` — add prev/next buttons

- New helper `goRelative(delta: -1 | 1)` that re-issues the same
  `/api/ad/next` call the rotation timer uses. Today the widget does:
  `POST /api/ad/next { sourceId, ...runtime }` and the server advances
  the cursor. Calling that twice rapidly moves two items — but we want
  "previous". The server's `nextItem` only advances forward
  (`cursor += 1` in `src/service.ts:323-324`), so to support "previous"
  we need a server-side direction flag, or a separate endpoint.
- The minimal correct approach: add an optional `delta: number` field
  to the `/api/ad/next` request body. Default `1` (forward) keeps
  existing callers working. The service computes
  `cache.cursor = (cache.cursor + delta + items.length) % items.length`
  with `delta` allowed to be negative. Modulo a `+ length` keeps
  negative results non-negative.

### 3. `src/routes.ts` — accept `delta` on `/api/ad/next`

```ts
const delta = typeof body?.delta === 'number' && Number.isInteger(body.delta) ? body.delta : 1
const item = service.nextItem(sourceId, readRuntime(body), delta)
```

### 4. `src/service.ts` — `nextItem` accepts delta

```ts
nextItem(sourceId: string, runtime: AdRuntimeContext = {}, delta = 1): AdItem | undefined {
  const cache = this.cache.get(sourceId)
  if (cache === undefined || cache.items.length === 0) return undefined
  if (!this.isEligible(sourceId, runtime)) return undefined
  cache.cursor = ((cache.cursor + delta) % cache.items.length + cache.items.length) % cache.items.length
  const item = cache.items[cache.cursor]
  cache.cursor = (cache.cursor + 1) % cache.items.length  // so the next call returns a different item
  this.recordImpression(sourceId)
  return item
}
```

Note: the existing implementation advances the cursor by 1 *after*
reading, so each call returns a fresh item. With `delta`, we need to
either (a) apply `delta` to the read pointer, then bump by 1, or
(b) honor the user's intent literally — "go to next" means "show me
the *next* item from where I am now, and prepare the *one after
that* for the next call." Option (b) is what the existing code does
for delta=1. For `delta=-1` we want the previous item, and the
cursor should now point at it. Implementation: set cursor to the
*target* index (using modulo + length) and then advance by 1. That
way the next call returns the item AFTER the current one (forward
flow) regardless of whether we just did delta=+1 or delta=-1.

### 5. `src/client/AdWidget.tsx` — render the prev/next buttons

A small floating pair of round buttons, semi-transparent, visible on
hover. Positioned absolutely left/right of the widget. Each is a
`<button>` with `e.stopPropagation()` on mousedown so it doesn't
trigger the widget's drag-start, and `onClick` calls `goRelative(-1)`
or `goRelative(1)`.

Style:
```css
.navButton {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 28px; height: 28px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 3;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  backdrop-filter: blur(4px);
}
.widget:hover .navButton,
.widget:focus-within .navButton { opacity: 1; }
.navButton:hover { background: rgba(0, 0, 0, 0.85); }
.navPrev { left: 8px; }
.navNext { right: 8px; }
```

The user asked for "закрученные стрелки или стрелки справа/слева"
(round arrows or side arrows). The CSS above implements side arrows;
using `‹` and `›` characters. Round arrow characters are `↺`/`↻`
(curl arrows) — they don't quite read as "next item". Plain
`‹` / `›` are clearer. Going with the simple chevrons inside a
round button.

### 6. `src/client/constants.ts` — settings-side rotation constant

Add an export `DEFAULT_ROTATION_MS = 15_000` (renamed from
`WIDGET_ROTATION_MS` would break callers, so keep the export name
and add the new one as an alias). Then update `AdWidget.tsx` to read
`display.rotationMs ?? WIDGET_ROTATION_MS` for the actual interval
per render.

### 7. `src/client/types.ts` — `DisplayView.rotationMs`

```ts
export interface DisplayView {
  ...
  rotationMs?: number
}
```

### 8. `src/client/AdSettingsCard.tsx` — add rotation input

A small numeric input labeled "Rotation interval (s)" (or matching
locale key). When the user changes it, POST to `/api/ad/display`
with the new `rotationMs`. The widget picks it up on the next
`fetchDisplay()` poll (≤ 2s) or on the next rotation tick.

### 9. `src/service.ts` — round-trip `rotationMs` through the host config

This is host-side state. The host's display settings are read in
`fetchDisplay`. We need to:
- Accept `rotationMs` on the `POST /api/ad/display` body.
- Persist it to the same `display` state that's read by
  `fetchDisplay`.
- Include it in the `DisplayView` returned to the client.

Find the existing display-state code in `service.ts` and add
`rotationMs` to the stored object and the route response.

### 10. Verification

Manual:
- Open the page; drag the widget — should follow 1:1, no jumps.
- Hover the widget — see round prev/next buttons on the sides;
  click them — item changes immediately, cursor doesn't switch to
  grab, click on the widget surface itself still opens the
  per-item clickUrl.
- Open AdSettingsCard → Rotation interval → change to 5s → save;
  the next item appears within 5s.

Automated:
- Add a test in `test/service.test.ts` exercising `nextItem` with
  positive and negative deltas (1, -1, 2, -2, wrapping past 0).
- Re-run `npx vitest run`; the new tests pass and pre-existing
  failures remain unchanged (Intl locale, unrelated).

Build: `npx tsdown` clean, `npx tsc --noEmit` clean.

## Critical files

- `src/client/AdWidget.tsx` — drag fix, prev/next buttons
- `src/client/AdSettingsCard.tsx` — rotation input
- `src/client/constants.ts` — alias / new default
- `src/client/types.ts` — `DisplayView.rotationMs?: number`
- `src/client/ad.module.css` — `.navButton` styles
- `src/service.ts` — `nextItem(sourceId, runtime, delta)`;
  persist `rotationMs`
- `src/routes.ts` — read `body.delta` on `/api/ad/next`;
  accept `rotationMs` on `/api/ad/display`
- `test/service.test.ts` — extend with delta tests

## Out of scope

- Touch / pointer events for the nav buttons. The current widget
  uses `mousedown`/`mouseup` only. Mouse-only is fine; touch can be
  added later if reported.
- Keyboard shortcuts (arrow keys). The buttons are the requested
  control; keyboard can come later.
- Persisting `rotationMs` across restarts via the same mechanism the
  position uses — same channel (`/api/ad/display`); if the existing
  position is persisted, rotationMs follows automatically. Verify
  the existing persistence path covers it.
