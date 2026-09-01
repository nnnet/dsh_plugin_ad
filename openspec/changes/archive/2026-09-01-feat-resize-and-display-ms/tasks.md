# Tasks: feat-resize-and-display-ms

## Legend

- `[ ]` pending
- `[~]` in progress
- `[x]` done (verified)
- `[!]` blocked (user input required)

Tasks are written in execution order. Each task's `Acceptance`
mirrors the spec acceptance criteria it implements, so a checkoff
means "the test for this acceptance passed" — not just "I wrote
the code".

## 1. Schema & API surface (displayMs)

- [ ] 1.0 Create `src/display-time.ts` exporting
      `clampDurationMs(durationMs, minMs, maxMs): number | null`.
      Lives in `src/` (not `src/client/`) so server and client
      share the same implementation — server uses it when
      computing the response, client uses it on `loadedmetadata`.
      Tests reference the module by path, not by an internal
      helper.
- [ ] 1.1 Add `displayMs?`, `minVideoMs?`, `maxVideoMs?` to
      `AdSourceConfig` in `src/config.ts` (interface + zod schema).
      Defaults: `displayMs: 15_000`, `minVideoMs: 4_000`,
      `maxVideoMs: 120_000`. Bounds: 1 000..600 000 for `displayMs`,
      100..600 000 for the two clamps. Cross-field check
      `minVideoMs <= maxVideoMs` returns a clear error.
  - Acceptance: A-DISPLAYMS-1
- [ ] 1.2 Add `displayMs` to the `AdItemView` type the browser
      receives (additive only). Update `nextItem` / `/api/ad/next`
      to populate it.
  - Acceptance: A-DISPLAYMS-1, A-DISPLAYMS-2
- [ ] 1.3 Tests FIRST (`test/display-time.test.ts`):
  - `clampDurationMs(7000, 4000, 120000) === 7000`
  - `clampDurationMs(2000, 4000, 120000) === 4000`
  - `clampDurationMs(200000, 4000, 120000) === 120000`
  - `clampDurationMs(NaN, 4000, 120000) === null` (caller falls
    back to source.displayMs)
  - `clampDurationMs(Infinity, 4000, 120000) === null`
  - `clampDurationMs(0, 4000, 120000) === 4000` (a 0-duration video
    is treated as missing metadata, not as "rotate immediately")
- [ ] 1.4 Tests FIRST (`test/config-displayms.test.ts`):
  - source config: default values when fields omitted
  - source config: rejects `displayMs: 500` (below min)
  - source config: rejects `minVideoMs > maxVideoMs`
  - source config: rejects `displayMs: 700000` (above max)
- [ ] 1.5 Wire `displayMs` into `/api/ad/next` response. For video
      items, the server returns `displayMs: source.displayMs`
      (NOT the video duration — the browser does not have
      metadata at server time). The browser refines on
      `loadedmetadata` via `clampDurationMs`.
  - Acceptance: A-DISPLAYMS-1, A-DISPLAYMS-2

## 2. Widget rotation: per-item timer (displayMs aware)

- [ ] 2.1 Replace the existing `setInterval` rotation with a
      `setTimeout` chain in `AdWidget.tsx`. On every `item` change,
      cancel the pending timer and schedule a new one based on
      `item.displayMs ?? display.rotationMs ?? WIDGET_ROTATION_MS`.
      The cancellation MUST use a `useRef<number | null>` so the
      `setTimeout` id survives re-renders — this is the same
      pattern Pet uses for its own timers.
  - Acceptance: A-DISPLAYMS-4, A-DISPLAYMS-5
- [ ] 2.2 For video items, attach `onLoadedMetadata` to the
      `<video>` element. On metadata load, recompute the effective
      timeout
      (`clamp(duration * 1000, minVideoMs, maxVideoMs)`) and reset
      the timer. The bounds `minVideoMs` / `maxVideoMs` travel
      alongside the item (server-side or as a constant the client
      already knows — decide during implementation; document the
      choice in code). The metadata listener MUST be torn down
      on source switch (use `AbortController` or a
      `useEffect` cleanup) so an in-flight `loadedmetadata` from
      a stale `<video>` does not reset the new item's timer.
  - Acceptance: A-DISPLAYMS-3
- [ ] 2.3 On `<video>` `error` or 30 s metadata timeout, fall back
      to the source's `displayMs` default and keep rotating.
  - Acceptance: E4 (video error path)
- [ ] 2.4 Tests (`test/widget-rotation.test.ts`):
  - timer is cancelled and re-scheduled on `goRelative(±1)`
  - timer is cancelled and re-scheduled on `item.id` change
  - `displayMs` from item wins over `display.rotationMs` from
    settings, which wins over `WIDGET_ROTATION_MS` constant
  - video metadata with `duration: 7` produces a 7 s timer
  - video metadata with `duration: 60` clamps to `maxVideoMs`
  - `onError` path falls back to `displayMs`
  - metadata listener for a stale `<video>` does not reset a
    new item's timer (covers the source-switch race)

## 3. Resize handle (widget shell)

- [ ] 3.1 Add a `<div>` SE handle inside the widget root. `cursor:
      se-resize` baseline, `nwse-resize` while pointer is down.
      `role="button"`, `aria-label={t('ad.widget.resizeHint')}`.
  - Acceptance: R-RESIZE-1
- [ ] 3.2 Add `onPointerDown` to the handle. `e.stopPropagation()`
      so the widget's drag handler never sees the press.
      `setPointerCapture(e.pointerId)` on the handle element.
      Initialize `resizeRef = { startX, startY, startSize, pointerId }`
      — exactly the same shape as the existing `dragRef` for
      symmetry.
  - Acceptance: A-RESIZE-3
- [ ] 3.3 Document-level `pointermove` / `pointerup` /
      `lostpointercapture` listeners extend the existing
      `useEffect`. The move handler computes the new size, clamps
      to `MIN..MAX`, writes to a local `resizeSize` state for
      1:1 follow. `finishResize` commits through
      `POST /api/ad/display { size: N }` once on `pointerup`.
  - Acceptance: R-RESIZE-2, A-RESIZE-1
- [ ] 3.4 Tests (`test/widget-resize.test.ts`):
  - press on the handle populates `resizeRef`, NOT `dragRef`
  - press on the widget shell populates `dragRef`, NOT `resizeRef`
  - `pointermove` beyond MAX clamps the rendered width but does
    not yet commit
  - `pointerup` commits exactly one POST with the clamped size
  - `lostpointercapture` clears `resizeRef` without committing
- [ ] 3.5 CSS: `.resizeHandle` (32×32 px tap target; visible
      affordance is 16×16 centered), `.resizeHandle:active`,
      focus ring for keyboard users (the handle is focusable,
      `Tab` reaches it, `ArrowLeft` / `ArrowRight` nudge the size
      by 8 px, `Home`/`End` jump to the bounds). The 32×32
      minimum is iOS HIG / WCAG 2.5.5; the visible 16×16 stays
      unobtrusive.
  - Acceptance: R-RESIZE-5

## 4. Settings card: size slider + numeric input

- [ ] 4.1 In `AdSettingsCard.tsx`, render a range input
      (200..800, step 10) and a number input beside it. Both
      bound to the existing `settings.size` field. The numeric
      input shows the current value; the slider is the primary
      control.
  - Acceptance: R-RESIZE-3
- [ ] 4.2 Add a new locale key `ad.widget.size` and
      `ad.widget.sizeHint` to `en.ts` and `zh.ts`. The slider
      must be the only place users see the localized labels.
  - Acceptance: A-RESIZE-2
- [ ] 4.3 Wire both controls through the same
      `setSource` / settings transport the existing toggles use.
      A change to either control:
  - Optimistically updates `display.size` via the live
    `setDisplay` (same pattern as the drag commit).
  - Triggers a settings save (debounced or on blur — match
    the existing pattern in the card).
  - Acceptance: A-RESIZE-2, R-RESIZE-3
- [ ] 4.4 Tests (`test/settings-size-control.test.ts`):
  - changing the slider updates `settings.size` and triggers
    one save
  - changing the numeric input updates `settings.size` and
    triggers one save
  - values are clamped to 200..800 on the input level
    (preventing invalid POSTs)

## 5. Persistence and live update

- [ ] 5.1 The existing `fetchDisplay` in `AdWidget.tsx` already
      honors `display.size` on the next poll. Verify with a test
      that the size change round-trips through the same
      `setDisplay` flow the drag-resize uses.
  - Acceptance: R-RESIZE-4
- [ ] 5.2 Manual smoke (browser, after build):
  1. Resize the widget via the handle to 500 px. Reload. The
     widget is 500 px wide. The settings card shows 500 in the
     numeric input and the slider at the matching position.
  2. Move the slider to 280. The widget shrinks live. The
     handle is at the new bottom-right.
  3. Switch to a 7 s video source. The widget waits 7 s
     between rotations, not 15 s.
  4. Press prev while the timer has 3 s left. The new item
     rotates after its own `displayMs`, not 3 s.

## 6. Documentation

- [ ] 6.1 Update `example.config.yaml` with a documented
      `displayMs`, `minVideoMs`, `maxVideoMs` block on
      `tyan-videos` (3-second test clip) and on `csgo-market`
      (10-second non-video default).
- [ ] 6.2 Update `src/config.ts` JSDoc for `AdSourceConfig` to
      document the new fields and the precedence rule (item
      `displayMs` → source `displayMs` → settings `rotationMs` →
      client default).
- [ ] 6.3 Changelog entry: short note in `CHANGELOG.md` (if
      the file exists), or a one-paragraph release note in the
      commit body.

## 7. Finalize

- [ ] 7.1 `npx tsc --noEmit` clean.
- [ ] 7.2 `npx vitest run` — all green (the four new test files
      pass; the existing 9/9 in `test/service.test.ts` still
      pass).
- [ ] 7.3 `npx tsdown` clean.
- [ ] 7.4 Manual browser smoke (Step 5.2 above) recorded in the
      finalize report.
- [ ] 7.5 Update `openspec/changes/feat-resize-and-display-ms/tasks.md`
      with all checkoffs before commit.
- [ ] 7.6 Commit on the feature branch (NOT `main`). Push.
      Remind the user to archive the change after merge.
