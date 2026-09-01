/**
 * The floating ad widget — content-only surface, modeled on the
 * dsh-pet sprite. The widget itself renders nothing of its own; only
 * the creative inside (a `<video>` for tyan-videos, a marketplace card
 * for CS:GO, an `<img>` for image items) is visible. The shell exists
 * so the creative can be drag-positioned.
 *
 * Visibility rules (matched to the Pet sprite UX):
 *  - `pluginEnabled === false` (plugin disabled by the host) →
 *    render nothing. The user must re-enable the plugin in their host
 *    config; this is the only state where the widget truly disappears.
 *  - `display.visible === false` → render nothing (user explicitly hid
 *    the widget via the AdSettingsCard).
 *  - `display.enabled === false` → render a small "召唤" / off-state
 *    pill, clickable to re-enable. The widget position is preserved
 *    so the user doesn't lose track of where it lives.
 *  - `display.enabled === true` and source has no current item →
 *    render the shell at min-size 120x120, source picker on hover.
 *    The user can drag, switch source, or wait for the next rotation.
 *  - `display.enabled === true` and an item is loaded → render the
 *    creative full-size; the shell sizes to content.
 *
 * @module dsh_plugin_ad/client/AdWidget
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MutableRefObject } from 'react'
import { SimpleCreative } from './SimpleCreative.tsx'
import { MarketplaceRenderer } from './MarketplaceRenderer.tsx'
import { t } from './locales.ts'
import { API_PREFIX as API_PATH, WIDGET_ROTATION_MS, DISPLAY_POLL_MS } from './constants.ts'
import { clampDurationMs, DEFAULT_MIN_VIDEO_MS, DEFAULT_MAX_VIDEO_MS, pickRotationMs } from '../display-time.ts'
import type {
  AdItemView,
  AdRuntimeContext,
  SourceView,
  DisplayView,
  SourcesResponse,
} from './types.ts'
import styles from './ad.module.css'

const API_PREFIX = API_PATH

async function adFetch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, body === undefined
    ? {}
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
  return response.json() as Promise<T>
}

function runtimeContext(): AdRuntimeContext {
  if (typeof document === 'undefined') return {}
  return {
    locale: document.documentElement.lang || undefined,
    path: typeof location !== 'undefined' ? location.pathname : undefined,
  }
}

const DEFAULT_DISPLAY: DisplayView = {
  visible: true,
  enabled: true,
  decorationEnabled: true,
  size: 240,
  right: 24,
  bottom: 20,
}

/** Bounds for the widget width (px). Mirrors the host schema in
 *  `src/config.ts` and the server-side clamp in
 *  `AdService.setDisplay`. Default 200..800. The slider in
 *  `AdSettingsCard` and the SE handle both use these bounds so
 *  neither path can drive the widget out of range. */
const MIN_WIDGET_SIZE = 200
const MAX_WIDGET_SIZE = 800

export function AdWidget(): React.ReactElement {
  const [sources, setSources] = useState<SourceView[]>([])
  const [sourceId, setSourceId] = useState<string | undefined>(undefined)
  const [item, setItem] = useState<AdItemView | null | undefined>(undefined)
  const [display, setDisplay] = useState<DisplayView>(DEFAULT_DISPLAY)
  const [pluginEnabled, setPluginEnabled] = useState(true)
  const [videoError, setVideoError] = useState(false)

  // --- Display fetch (initial + on settings change) -----------------------

  // Tracks which `sourceId` we've already kicked off a `/api/ad/next`
  // for. Without this, a widget that mounts before the host has the
  // source config loaded would have to wait for the *next* sources
  // poll (2 s by default) before its first item lands — and the
  // prev/next nav buttons can't render until `item` is set, so the
  // user perceives "buttons don't work for 20 s" while the host
  // catches up. We re-fire `/api/ad/next` directly from `fetchDisplay`
  // the first time we resolve a target source, so the buttons appear
  // within the first poll cycle (typically < 200 ms after sources
  // load). After that the existing `useEffect([sourceId])` keeps
  // things in sync, and this ref keeps us from re-issuing the same
  // request on every poll.
  const fetchedForSourceRef = useRef<string | null>(null)

  /**
   * Monotonic counter for in-flight `/api/ad/next` requests. Every
   * call (manual goRelative, source-change effect, fetchDisplay
   * kick-off, rotation tick) bumps the seq and remembers it. When
   * the response lands, we compare against the *current* seq and
   * drop the result if a newer request has started. Without this,
   * the user-reported "prev/next stop working randomly" bug fires:
   * the rotation-effect fetchNext and a manual goRelative race each
   * other, and whichever lands second wins; if the user clicked
   * `›` right as a source-change effect fired, the effect's bare
   * (no-delta) response arrives second and overwrites the new item
   * the user actually wanted. Pair with `nextAbortRef` so the
   * superseded fetch is also aborted (saves bandwidth + eliminates
   * the impression POST the server would otherwise log for a
   * creative the user never saw).
   */
  const nextRequestSeqRef = useRef(0)
  const nextAbortRef = useRef<AbortController | null>(null)
  /**
   * Ref-mirror of `sourceId` for use inside the rotation tick
   * closure. The rotation effect schedules a setTimeout that may
   * fire long after the effect's render snapshot — a sources poll
   * can change `sourceId` in between, and reading the stale
   * closure value would bill the rotation tick against the old
   * source. Same pattern `dragPosRef` / `resizeSizeRef` use for
   * pointer-event closures.
   */
  const sourceIdRef = useRef<string | undefined>(undefined)
  useEffect(() => { sourceIdRef.current = sourceId }, [sourceId])

  /**
   * Fire a `/api/ad/next` request and apply the result to the
   * current item, but only if no newer request has started in the
   * meantime. Centralizes the seq-bump + abort-prev + drop-stale +
   * impression logic so every caller (manual prev/next, rotation
   * tick, source-change effect, fetchDisplay kick-off) shares the
   * exact same race-resolution. Without this helper the four call
   * sites each had their own copy of the fetch block, and any
   * drift between them re-introduced the "buttons stop working
   * randomly" regression.
   *
   * `delta` is the OpenSpec prev/next signal (`-1` / `+1` / omitted);
   * it flows through to the server unchanged. The caller passes the
   * `sourceId` it wants the request to be billed against — passing
   * the current `sourceId` from closure would silently use a stale
   * value if a host-driven source switch had just landed, so we
   * accept it as a parameter and let each caller decide.
   */
  const requestNext = useCallback((sid: string | undefined, delta?: -1 | 1): void => {
    // Cancel any in-flight request — the response, when it lands,
    // will see a stale seq and drop. Aborting also releases the
    // socket so the network isn't double-paying for the doomed call.
    if (nextAbortRef.current !== null) {
      nextAbortRef.current.abort()
    }
    const controller = new AbortController()
    nextAbortRef.current = controller
    const seq = ++nextRequestSeqRef.current

    const body: Record<string, unknown> = { ...runtimeContext() }
    if (sid !== undefined) body.sourceId = sid
    if (delta !== undefined) body.delta = delta

    adFetch<{ ok: true; item: AdItemView | null } | { ok: false; error: string }>(
      API_PREFIX + '/next',
      body,
      controller.signal,
    ).then((res) => {
      // Stale-response guard. If a newer request has been issued
      // (seq bumped) or this request was aborted, drop the result
      // without touching `item`. The next/newer response will set
      // `item` instead. This is the line that fixes the
      // "prev/next don't do anything after switching back from
      // another plugin" bug: a sources-poll-driven effect fetch
      // races the manual goRelative, the bare /next from the
      // effect used to land second and clobber the manual item.
      if (seq !== nextRequestSeqRef.current) return
      nextAbortRef.current = null
      if (res.ok) {
        setItem(res.item)
        if (res.item !== null) {
          void fetch(API_PREFIX + '/impression', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceId: sid, itemId: res.item.id }),
          }).catch(() => {})
        } else {
          console.info('[dsh-ad] /next returned no item for source:', sid)
        }
      } else {
        console.info('[dsh-ad] /next returned error:', res.error)
      }
    }, (err: unknown) => {
      // AbortError is the expected path for a superseded request —
      // silent. Anything else is a real network failure; we drop
      // `item` to null so the next retry surfaces the empty
      // placeholder instead of showing a stale creative.
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (seq !== nextRequestSeqRef.current) return
      nextAbortRef.current = null
      console.info('[dsh-ad] /next fetch rejected for source:', sid, err)
    })
  }, [])

  const fetchDisplay = useCallback((): void => {
    adFetch<SourcesResponse>(API_PREFIX + '/sources', { ...runtimeContext() }).then((res) => {
      const list = res.sources ?? []
      const first = list.find((s) => s.id !== undefined && s.eligible) ?? list[0]
      setSources(list)
      const hostActive = res.activeSourceId
      const targetSource = hostActive !== undefined && hostActive !== '' && list.some(s => s.id === hostActive)
        ? hostActive
        : first?.id
      setSourceId((prev) => {
        if (targetSource === undefined) return prev
        return prev === targetSource ? prev : targetSource
      })
      // Direct kick-off: if we just resolved a target source and we
      // haven't fetched an item for it yet, fire `/api/ad/next` now.
      // The `useEffect([sourceId])` would also fire on a *change* of
      // `sourceId`, but the very first mount (or any time the widget
      // comes up against an empty sources list) needs this explicit
      // call so the nav buttons have an `item` to gate on as fast as
      // the host can answer.
      if (
        targetSource !== undefined
        && fetchedForSourceRef.current !== targetSource
      ) {
        fetchedForSourceRef.current = targetSource
        // Fire the same `requestNext` the effect uses, but with the
        // just-resolved target source directly — the effect won't
        // see the new `sourceId` until the next render, so the
        // imperative call is what makes the item land in the first
        // poll cycle (see `fetchedForSourceRef` for the full
        // "buttons don't work for 20 s" story).
        requestNext(targetSource)
      }
      if (res.display !== undefined) {
        setDisplay((prev) => {
          // Only merge host-controlled fields (size, visibility, etc.)
          // from the poll. Drag-driven `right`/`bottom` are owned by
          // this widget — the user just dropped the widget at a
          // specific spot, and the very next poll must not snap it
          // back. The AdSettingsCard, summon pill, and rotation
          // interval flow through `/display` and converge here
          // naturally, so dropping the right/bottom copy from the
          // poll-merge doesn't lose host-driven updates.
          const next = { ...prev }
          const incoming = res.display
          if (typeof incoming.visible === 'boolean') next.visible = incoming.visible
          if (typeof incoming.enabled === 'boolean') next.enabled = incoming.enabled
          if (typeof incoming.decorationEnabled === 'boolean') next.decorationEnabled = incoming.decorationEnabled
          if (typeof incoming.size === 'number') next.size = incoming.size
          if (typeof incoming.rotationMs === 'number') next.rotationMs = incoming.rotationMs
          if (
            prev.visible === next.visible
            && prev.enabled === next.enabled
            && prev.decorationEnabled === next.decorationEnabled
            && prev.size === next.size
            && prev.rotationMs === next.rotationMs
          ) {
            return prev
          }
          return next
        })
      }
      if (typeof res.enabled === 'boolean') {
        setPluginEnabled((prev) => prev === res.enabled ? prev : res.enabled as boolean)
      }
    }, () => { /* silent */ })
  }, [])

  useEffect(() => {
    fetchDisplay()
    let timer: number | undefined
    const start = (): void => {
      if (timer === undefined && document.visibilityState === 'visible') {
        timer = window.setInterval(fetchDisplay, DISPLAY_POLL_MS)
      }
    }
    const stop = (): void => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        fetchDisplay()
        start()
      } else {
        stop()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchDisplay])

  // --- Item rotation ------------------------------------------------------

  useEffect(() => {
    // Source-driven fetch: every time `sourceId` lands (initial
    // mount, user picked a different source, host switched while
    // the tab was hidden) we want a fresh item for that source.
    // The same `requestNext` helper used by the manual prev/next
    // and the rotation tick owns the seq/abort/drop-stale logic,
    // so a poll-driven source switch that fires here can't
    // overwrite a manual goRelative result the user already saw.
    if (sourceId !== undefined) requestNext(sourceId)
  }, [sourceId, requestNext])

  // Keep the "already fetched for this source" ref in sync with the
  // current `sourceId` so the direct kick-off in `fetchDisplay` only
  // fires for a freshly-resolved target — user-driven source changes
  // (via `onSourceChange`) flow through the effect above and don't
  // need a second fetch from the next poll.
  useEffect(() => {
    fetchedForSourceRef.current = sourceId ?? null
  }, [sourceId])

  // Cancel any in-flight `/next` when the widget unmounts (route
  // change, plugin disable, host hot-reload). Without this, a
  // pending response can fire `setItem` after the component is
  // gone and React 18 strict-mode will warn. The seq-guard in
  // `requestNext` already prevents the visible "ghost" item from
  // appearing, but the abort is the cleaner teardown.
  useEffect(() => {
    return () => {
      if (nextAbortRef.current !== null) {
        nextAbortRef.current.abort()
        nextAbortRef.current = null
      }
    }
  }, [])

  // --- Auto-rotation: per-item `setTimeout` chain ----------------------
  //
  // The previous `setInterval` ran on a single global timer (15 s by
  // default) and ignored each item's own `displayMs` — a 5 s video
  // was followed by 10 s of dead air, a 30 s video was cut off
  // mid-engagement. The OpenSpec change `feat-resize-and-display-ms`
  // replaces the interval with a per-item timeout chain: every
  // `item` change (or a `display.rotationMs` edit) cancels the
  // pending timer and schedules a new one from the current item's
  // `displayMs`. Manual prev/next go through the same path
  // because they call `setItem(...)`, which re-runs this effect.
  //
  // Video items add a second refinement: the server's `displayMs`
  // is the source's default (it has no `<video>` element). The
  // browser reads `<video>.duration` on `loadedmetadata` and, if
  // the value is usable, re-derives the timer with
  // `clampDurationMs(duration, minVideoMs, maxVideoMs)`. Until
  // metadata loads (or if it errors), the source's `displayMs` is
  // the timer — same default the server advertised, no client-side
  // guesswork.
  const rotationTimerRef = useRef<number | null>(null)
  const cancelRotationTimer = useCallback((): void => {
    if (rotationTimerRef.current !== null) {
      window.clearTimeout(rotationTimerRef.current)
      rotationTimerRef.current = null
    }
  }, [])
  useEffect(() => {
    cancelRotationTimer()
    if (item === null || item === undefined) return
    const initialMs = pickRotationMs(item, display.rotationMs, WIDGET_ROTATION_MS)
    rotationTimerRef.current = window.setTimeout(() => {
      rotationTimerRef.current = null
      // Read the source id from a ref-mirror so the rotation tick
      // carries the *current* source even if the effect was
      // scheduled before a sources-poll-driven switch landed.
      // Without the ref, a late rotation would fire against a
      // stale source id and the response would be dropped by the
      // `requestNext` helper's seq guard — looking like "the
      // widget stopped rotating". The `requestNext` helper
      // already owns the race-resolution, so we just hand it the
      // current source.
      requestNext(sourceIdRef.current)
    }, initialMs)
    return () => { cancelRotationTimer() }
  }, [item?.id, item?.displayMs, display.rotationMs, requestNext])

  /**
   * Re-derive the rotation timer from the just-loaded `<video>`
   * duration. Called once per `loadedmetadata` by `SimpleCreative`.
   * If the duration is usable (finite, positive) and clamps to a
   * different value than the current `displayMs`, we patch the item
   * in place — `setItem({ ...item, displayMs: clamped })` — and the
   * rotation effect above re-keys off the new value, rescheduling
   * the pending timer.
   *
   * Stale-metadata guard: the effect keys off `item?.id`, so when
   * a new item lands before the old `<video>` fires `loadedmetadata`
   * the old handler is dropped along with the old element (React
   * unmounts the `<video>` on source switch). The `onVideoError`
   * path also surfaces a 30 s timeout: if the `<video>` never
   * loads metadata within 30 s (network error, autoplay block,
   * unsupported codec), we leave the source's `displayMs` in place
   * and rotation continues on that timer. The `onError` handler
   * already shows a fallback message instead of a black box.
   */
  const onVideoLoadedMetadata = useCallback((durationMs: number): void => {
    const clamped = clampDurationMs(durationMs, DEFAULT_MIN_VIDEO_MS, DEFAULT_MAX_VIDEO_MS)
    if (clamped === null) return
    setItem((prev) => {
      if (prev === null || prev === undefined) return prev
      if (prev.displayMs === clamped) return prev
      return { ...prev, displayMs: clamped }
    })
  }, [])

  /**
   * Manually step the rotation by `delta` items (±1) without waiting
   * for the auto-rotation timer. Used by the prev/next nav buttons.
   * Goes through the shared `requestNext` so a manual click and a
   * concurrent source-change effect share the same race-resolution:
   * whichever seq lands last wins, the other is dropped. The
   * `sourceId` is read from the callback's `useCallback` deps, so
   * the request always carries the freshly-rendered source even
   * if a sources poll updated it a tick earlier.
   */
  const goRelative = useCallback((delta: -1 | 1): void => {
    requestNext(sourceId, delta)
  }, [sourceId, requestNext])

  useEffect(() => {
    setVideoError(false)
  }, [item?.id])

  const active = sources.find((s) => s.id === sourceId)

  // --- Click-through -----------------------------------------------------

  const openClickThrough = useCallback((item: AdItemView | null | undefined): void => {
    if (item === undefined || item === null) return
    const url = item.clickUrl
    if (url === undefined || url === '') return
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      // No-op; the user can still navigate manually.
    }
  }, [])

  // --- Source picker (hover-revealed) -----------------------------------

  const onSourceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>): void => {
    const next = e.target.value
    if (next === '' || next === sourceId) return
    setSourceId(next)
    void adFetch<{ ok: true }>(API_PREFIX + '/source', { sourceId: next }).catch(() => {})
  }, [sourceId])

  // --- Drag (Pointer Events, modeled on dsh-pet's PetSprite) -----------
  //
  // The earlier mousedown/mousemove/mouseup-on-document approach had two
  // failure modes:
  //   1. mouseup on document was missed when the release happened over
  //      another element (e.g. the hover-revealed nav buttons) or after
  //      focus shifted — the cursor appeared "stuck" to the widget and
  //      kept translating it on the next press until a stray click
  //      finally cleared it.
  //   2. Persisting on every mousemove meant a network roundtrip per
  //      frame; if any single POST dropped (offline, tab-throttled,
  //      aborted on visibilitychange), the next /sources poll would
  //      restore the host-side `display` and the widget would snap back
  //      to its previous position the moment the user let go.
  //
  // Pointer Events fix (1) for free: setPointerCapture() reroutes every
  // pointermove/pointerup for the gesture to the original target, even
  // if the cursor leaves the element. (2) is fixed by writing the
  // in-flight position to a local `dragPos` state (smooth, no
  // roundtrip) and only committing the final position once on
  // pointerup — exactly the same shape PetSprite uses.

  /** Threshold in CSS pixels for a press to count as a drag (vs a click).
   *  Below this delta, pointerup runs the click-through. Pet uses 4;
   *  we use 6 because our creative is wider and a small jitter on a
   *  marketplace card is easy to mistake for a tap. */
  const DRAG_THRESHOLD_PX = 6

  /** Per-frame drag offset. Lives in local state so React updates the
   *  style attribute smoothly, but does NOT touch the host-controlled
   *  `display` until pointerup commits it. `null` = no drag in
   *  progress, render the host position. */
  const [dragPos, setDragPos] = useState<{ right: number; bottom: number } | null>(null)
  /** Mirror of `dragPos` for the pointerup handler. The handler is
   *  wired to the same React node, so React will only swap a fresh
   *  callback in on the next render — and pointerup can fire before
   *  that render lands. Reading through a ref avoids a stale closure
   *  and guarantees we commit the position the user actually saw. */
  const dragPosRef = useRef<{ right: number; bottom: number } | null>(null)
  useEffect(() => { dragPosRef.current = dragPos }, [dragPos])

  /** Resize gesture (SE handle). Symmetric to `dragPos` /
   *  `dragPosRef`: a local `resizeSize` for 1:1 follow without
   *  round-tripping on every pointermove, and a ref-mirror so the
   *  pointerup handler (registered in a single mount-time effect
   *  for closure stability) reads the latest in-flight value. */
  const [resizeSize, setResizeSize] = useState<number | null>(null)
  const resizeSizeRef = useRef<number | null>(null)
  useEffect(() => { resizeSizeRef.current = resizeSize }, [resizeSize])

  /** Snapshot of the press: where the pointer started, plus the host
   *  position at that moment. Immutable for the duration of the
   *  gesture — recomputing from this snapshot each frame is what makes
   *  the cursor follow 1:1. */
  const dragRef = useRef<{ startX: number; startY: number; right: number; bottom: number; pointerId: number } | null>(null)
  /** Snapshot of the resize gesture: cursor start, the widget's
   *  current width at pointerdown, and the active pointer id. Same
   *  shape as `dragRef` so the existing document-level
   *  pointermove/pointerup listeners (registered once at mount
   *  for closure stability) can be extended to handle both
   *  gestures without re-binding handlers on every re-render. */
  const resizeRef = useRef<{ startX: number; startY: number; startSize: number; pointerId: number } | null>(null)
  /** Set true the first time the press crosses the drag threshold. The
   *  onClick handler reads it directly to swallow the trailing click
   *  that some browsers (trackpads) still emit after a small drag.
   *  IMPORTANT: this flag is reset only at the *next* pointerdown, NOT
   *  in pointerup. The browser fires a synthetic `click` immediately
   *  after pointerup; if we cleared the flag in pointerup, onClick
   *  would see `draggedRef === false` and open the click-through URL
   *  on every drag. Reset-in-pointerup regression surfaced once;
   *  keep this in mind if refactoring the gesture lifecycle. */
  const draggedRef = useRef(false)
  const widgetRef = useRef<HTMLDivElement | null>(null)

  /**
   * Whether the user is currently pressing anywhere on the widget
   * (shell, handle, nav buttons, or source <select>). Drives the
   * `data-dsh-ad-active="1"` attribute the CSS reads to reveal the
   * chrome — without this, a press on the bottom-right corner that
   * begins a resize would have the resize glyph fade out mid-gesture
   * (no `:hover` while pointer capture reroutes the cursor). Latched
   * true on `pointerdown` (any descendant), released on `pointerup` /
   * `pointercancel` / `lostpointercapture` for the same pointer id.
   *
   * Kept in state, not a ref, so the data-attribute on the JSX root
   * re-renders synchronously with the press — the CSS only reads the
   * attribute, the actual press logic (drag, resize, click-through)
   * still flows through `dragRef`/`resizeRef`/`draggedRef` unchanged.
   */
  const [chromeRevealed, setChromeRevealed] = useState(false)

  /**
   * Capture-phase pointerdown: fires before any descendant's
   * `stopPropagation` (which the resize handle and the nav buttons
   * use to keep the drag gesture off their backs). This is the only
   * listener that gets a guaranteed-true signal for every press on
   * the widget, regardless of which descendant caught the event. We
   * don't start a drag here — the widget-level drag handler still
   * runs in the bubble phase and is gated by its own target check.
   */
  const onPointerDownCapture = useCallback((_e: ReactPointerEvent<HTMLDivElement>): void => {
    setChromeRevealed(true)
  }, [])

  const onPointerDownWidget = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    // Don't start a drag from interactive children — a press on the
    // prev/next buttons, source <select>, video controls, or the
    // SE resize handle should pass through to their own handlers.
    // The handle's onPointerDown calls stopPropagation, so this
    // check is defense-in-depth: if anything ever bypasses that,
    // a press on the handle must not also start a drag.
    if ((e.target as HTMLElement).closest('button, select, input, a, video[controls], [data-dsh-resize-handle]') !== null) return
    // Capture the gesture on the actual target element, not the
    // widget root. Per the W3C Pointer Events spec, the capture target
    // receives every pointermove/pointerup for the gesture, even when
    // the cursor leaves its bounds — which is exactly what makes the
    // widget follow the cursor when the user drags fast and the cursor
    // briefly ends up over a host element outside the widget. Setting
    // capture on the *target* (rather than the parent) also matches
    // the pet sprite's behavior and avoids a subtle bug where capture
    // on the parent + a child stopPropagation() drops pointerup
    // entirely, leaving dragRef populated and the next press stuck
    // ("cursor won't release the widget").
    const targetEl = e.target as HTMLElement
    try { targetEl.setPointerCapture(e.pointerId) } catch { /* not supported */ }
    // Suppress text selection / native image drag while the gesture is
    // in flight — matches the pet sprite's pointerdown behavior.
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      right: display.right,
      bottom: display.bottom,
      pointerId: e.pointerId,
    }
    // Reset the drag flag here (not in pointerup) so onClick after
    // pointerup still sees "this gesture was a real drag" and swallows
    // the trailing click. A bare tap never sets the flag, so a fresh
    // press always starts with a clean false.
    draggedRef.current = false
  }, [display.right, display.bottom])

  /**
   * Press on the SE handle. The handle is a direct child of the
   * widget root and `stopPropagation`s this event so the widget's
   * own `onPointerDown` never sees it — the two gestures are
   * mutually exclusive by element target, not by timing. The
   * handle's own `setPointerCapture` reroutes every pointermove /
   * pointerup for the gesture to the handle element, even when
   * the cursor leaves the 32×32 hit area, so a fast resize sweep
   * outside the widget still works.
   */
  const onPointerDownResize = useCallback((e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const targetEl = e.currentTarget
    try { targetEl.setPointerCapture(e.pointerId) } catch { /* not supported */ }
    e.preventDefault()
    const liveSize = resizeSizeRef.current ?? display.size
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startSize: liveSize,
      pointerId: e.pointerId,
    }
    // Seed the local snapshot so the very first pointermove reads a
    // defined start (the render is still showing the host value).
    if (resizeSizeRef.current === null) {
      resizeSizeRef.current = liveSize
      setResizeSize(liveSize)
    }
  }, [display.size])

  // Single mount-time registration of move/up/lostpointercapture
  // listeners. Reading all state from refs makes this closure stable
  // across re-renders — no stale closure race that could miss the
  // pointerup that releases the gesture. Re-binding handlers on every
  // re-render was the root cause of the "cursor won't release" bug:
  // a setDragPos-driven re-render between pointermove and pointerup
  // could leave the new closure un-attached, dropping the very event
  // that clears dragRef, so the next press inherited a stale gesture.
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const drag = dragRef.current
      if (drag !== null && drag.pointerId === e.pointerId) {
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
        // Compute from the immutable start snapshot — `drag.right/bottom`
        // were captured at pointerdown and never mutate, so the widget
        // follows the cursor exactly even if a previous move event was
        // dropped.
        const right = clampPx(drag.right - dx, 0, Math.max(0, window.innerWidth - width))
        const bottom = clampPx(drag.bottom - dy, 0, Math.max(0, window.innerHeight - height))
        const next = { right, bottom }
        const prev = dragPosRef.current
        if (prev === null || prev.right !== right || prev.bottom !== bottom) {
          dragPosRef.current = next
          setDragPos(next)
        }
        return
      }
      // Resize gesture (SE handle). Symmetric to drag: anchored at the
      // SE corner, so width grows directly with the cursor's rightward
      // delta. We include dy as a secondary signal so a future
      // diagonal handle feels right; the SE-only handle is dominated
      // by dx in practice.
      const resize = resizeRef.current
      if (resize !== null && resize.pointerId === e.pointerId) {
        const dx = e.clientX - resize.startX
        const next = clampPx(resize.startSize + dx, MIN_WIDGET_SIZE, MAX_WIDGET_SIZE)
        const prev = resizeSizeRef.current
        if (prev !== next) {
          resizeSizeRef.current = next
          setResizeSize(next)
        }
      }
    }
    const finishGesture = (pointerId: number, committed: boolean): void => {
      const drag = dragRef.current
      if (drag !== null && drag.pointerId === pointerId) {
        const wasDragged = draggedRef.current
        const finalPos = dragPosRef.current
        dragRef.current = null
        dragPosRef.current = null
        setDragPos(null)
        // NOTE: do NOT reset `draggedRef.current` here. The browser fires
        // a trailing `click` after pointerup, and onClick uses
        // `draggedRef.current` to decide whether to swallow the click
        // (real drag) or run click-through (tap). Resetting the flag in
        // pointerup made every drag end in a click-through on the
        // widget. The flag is reset at the *next* pointerdown instead.
        if (!wasDragged || !committed || finalPos === null) return
        // Commit the final position to host truth exactly once. The
        // functional setDisplay updates the local copy (so the widget
        // doesn't visibly snap back during the in-flight roundtrip) AND
        // fires the persist call. Failures are logged but not reverted —
        // the user already released the mouse and would experience a
        // jarring jump if we rolled the position back.
        const finalRight = finalPos.right
        const finalBottom = finalPos.bottom
        setDisplay(prev => {
          if (prev.right === finalRight && prev.bottom === finalBottom) {
            return prev
          }
          const next = { ...prev, right: finalRight, bottom: finalBottom }
          adFetch<{ ok: true; display: DisplayView }>(API_PREFIX + '/display', {
            right: finalRight,
            bottom: finalBottom,
          }).then((res) => {
            if (res.ok && res.display !== undefined) {
              setDisplay(d => {
                if (d.right === res.display.right && d.bottom === res.display.bottom) return d
                return { ...d, right: res.display.right, bottom: res.display.bottom }
              })
            }
          }).catch((err: unknown) => {
            console.info('[dsh-ad] /display persist rejected:', err)
          })
          return next
        })
        return
      }
      // Resize finish: commit the final width exactly once. The
      // functional setDisplay mirrors the drag-commit pattern —
      // local copy first so the widget doesn't snap back, then the
      // POST in the background, then a reconciliation pass on
      // success. We only commit when the size actually changed; a
      // bare tap (e.g. to focus the handle) doesn't churn the
      // host's saved value.
      const resize = resizeRef.current
      if (resize !== null && resize.pointerId === pointerId) {
        const finalSize = resizeSizeRef.current
        resizeRef.current = null
        resizeSizeRef.current = null
        setResizeSize(null)
        if (!committed || finalSize === null || finalSize === resize.startSize) return
        setDisplay(prev => {
          if (prev.size === finalSize) return prev
          const next = { ...prev, size: finalSize }
          adFetch<{ ok: true; display: DisplayView }>(API_PREFIX + '/display', {
            size: finalSize,
          }).then((res) => {
            if (res.ok && res.display !== undefined) {
              setDisplay(d => {
                if (d.size === res.display.size) return d
                return { ...d, size: res.display.size }
              })
            }
          }).catch((err: unknown) => {
            console.info('[dsh-ad] /display persist rejected:', err)
          })
          return next
        })
      }
    }
    const onUp = (e: PointerEvent): void => {
      // Release the chrome latch on any pointerup, regardless of
      // whether it corresponds to a tracked drag/resize gesture. The
      // dragRef/resizeRef check keeps the latch true if another
      // pointer is still down (e.g. multi-touch, or a second mouse
      // button); we only flip the visible state when no tracked
      // gesture is left holding it.
      finishGesture(e.pointerId, true)
      if (dragRef.current === null && resizeRef.current === null) {
        setChromeRevealed(false)
      }
    }
    // Safety net: if the browser revokes capture (e.g. the user
    // releases outside any element we control, or a focus shift kills
    // the gesture), `lostpointercapture` fires and we still tear down
    // — this is the path that fixes the "cursor stuck" bug. Capture is
    // implicitly released after a normal pointerup, so this listener
    // is mostly redundant for happy-path gestures, but it's the one
    // that catches the edge case.
    const onLostCapture = (e: PointerEvent): void => {
      finishGesture(e.pointerId, false)
      if (dragRef.current === null && resizeRef.current === null) {
        setChromeRevealed(false)
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    document.addEventListener('lostpointercapture', onLostCapture as EventListener, true)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      document.removeEventListener('lostpointercapture', onLostCapture as EventListener, true)
    }
  }, [])

  // --- Visibility gate (the ONLY place the widget renders nothing) -----

  // Keep a small Pet-style summon control for every locally hidden state.
  // Previously `visible: false` and `pluginEnabled: false` returned an
  // empty fragment, leaving no on-screen way to recover after a settings
  // edit. The control is deliberately the only UI in an off state — no
  // rectangle, labels, or ad chrome.
  if (!display.visible || !display.enabled || !pluginEnabled) {
    const summonStyle: React.CSSProperties = {
      right: `${display.right}px`,
      bottom: `${display.bottom}px`,
    }
    const onSummonClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
      e.stopPropagation()
      void adFetch<{ ok: true; display: DisplayView }>(API_PREFIX + '/display', {
        visible: true,
        enabled: true,
      }).then((res) => {
        if (res.ok) {
          setDisplay(prev => ({ ...prev, visible: true, enabled: true }))
          setPluginEnabled(true)
        }
      }).catch(() => {})
    }
    return (
      <button
        className={styles.summonPill}
        style={summonStyle}
        onClick={onSummonClick}
        onMouseDown={(e) => { e.stopPropagation() }}
        title={t('ad.widget.title')}
        aria-label={t('ad.widget.title')}
      >
        <span className={styles.summonIcon}>▶</span>
      </button>
    )
  }

  // Live surface. The shell auto-sizes to content (a 240x240 video
  // stays 240x240, a marketplace card grows to fit its body). When
  // empty (no item yet, or media failed to load) the container
  // collapses to 120x120 — still a valid grab target so the user can
  // drag it before any source item has loaded.

  // While dragging we render from the local `dragPos` snapshot (smooth
  // 1:1 follow without touching host truth on every frame). When the
  // gesture is over, the committed host position in `display` takes
  // over. The cursor reflects that: `grab` when idle, `grabbing`
  // while a press is active — same UX as the pet sprite.
  const renderedPos = dragPos ?? { right: display.right, bottom: display.bottom }
  // While the SE handle is in a resize gesture, the widget's width
  // tracks the in-flight `resizeSize` snapshot for 1:1 follow
  // without round-tripping on every pointermove. Otherwise we render
  // the host-truth `display.size`. The `Math.max` guards the
  // `display.size < 200` case (legacy hosts may ship a value below
  // the new floor) and lets the CSS min-width keep the surface
  // grabbable.
  const liveSize = resizeSize ?? display.size
  const widgetStyle: React.CSSProperties = {
    width: liveSize >= 200 ? `${liveSize}px` : undefined,
    maxWidth: 'calc(100vw - 32px)',
    minWidth: '120px',
    minHeight: '120px',
    right: `${renderedPos.right}px`,
    bottom: `${renderedPos.bottom}px`,
    cursor: dragPos === null && resizeSize === null ? 'grab' : 'grabbing',
    touchAction: 'none',
  }

  /**
   * Keyboard affordances for the SE handle (the handle itself is a
   * `<button>` so it gets focus + Enter/Space for free). Arrow keys
   * nudge the width by 8px; Home/End jump to the bounds; PageUp/
   * PageDown take a 32px step. Every change commits via the same
   * `display` endpoint the slider uses, so the persistence path is
   * the same regardless of how the resize was triggered.
   */
  const onResizeKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>): void => {
    let delta = 0
    let jump: number | null = null
    switch (e.key) {
      case 'ArrowLeft': delta = -8; break
      case 'ArrowRight': delta = 8; break
      case 'PageDown': delta = -32; break
      case 'PageUp': delta = 32; break
      case 'Home': jump = MIN_WIDGET_SIZE; break
      case 'End': jump = MAX_WIDGET_SIZE; break
      default: return
    }
    e.preventDefault()
    e.stopPropagation()
    const target = jump ?? clampPx(display.size + delta, MIN_WIDGET_SIZE, MAX_WIDGET_SIZE)
    if (target === display.size) return
    setDisplay(prev => {
      if (prev.size === target) return prev
      const next = { ...prev, size: target }
      adFetch<{ ok: true; display: DisplayView }>(API_PREFIX + '/display', {
        size: target,
      }).then((res) => {
        if (res.ok && res.display !== undefined) {
          setDisplay(d => (d.size === res.display.size ? d : { ...d, size: res.display.size }))
        }
      }).catch((err: unknown) => {
        console.info('[dsh-ad] /display persist rejected:', err)
      })
      return next
    })
  }, [display.size])

  return (
    <div
      ref={widgetRef}
      className={styles.widget}
      style={widgetStyle}
      data-dsh-ad-size={display.size}
      data-dsh-ad-enabled={display.enabled ? '1' : '0'}
      data-dsh-ad-active={chromeRevealed ? '1' : undefined}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDownWidget}
      onClick={() => {
        // Trailing click after a real drag (trackpads, some touch
        // stacks). `draggedRef` is set during pointermove, cleared in
        // pointerup — a bare tap never sets it, so click-through runs.
        if (draggedRef.current) return
        openClickThrough(item)
      }}
    >
      {item !== null && item !== undefined && (
        <>
          <button
            className={`${styles.navButton} ${styles.navPrev}`}
            type="button"
            aria-label={t('ad.widget.navPrev')}
            title={t('ad.widget.navPrev')}
            onPointerDown={(e) => { e.stopPropagation() }}
            onClick={(e) => { e.stopPropagation(); if (draggedRef.current) return; goRelative(-1) }}
          >
            ‹
          </button>
          <button
            className={`${styles.navButton} ${styles.navNext}`}
            type="button"
            aria-label={t('ad.widget.navNext')}
            title={t('ad.widget.navNext')}
            onPointerDown={(e) => { e.stopPropagation() }}
            onClick={(e) => { e.stopPropagation(); if (draggedRef.current) return; goRelative(1) }}
          >
            ›
          </button>
        </>
      )}

      {sources.length > 1 && (
        <div className={styles.sourceBar}>
          <select
            className={styles.sourceSelect}
            value={sourceId ?? ''}
            onChange={onSourceChange}
            title={t('ad.widget.sourcePicker')}
            aria-label={t('ad.widget.sourcePicker')}
            onClick={(e) => { e.stopPropagation() }}
            onPointerDown={(e) => { e.stopPropagation() }}
          >
            {sources.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{!s.eligible ? ' *' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {item !== null && item !== undefined && !videoError && (
        item.type === 'product'
          ? <MarketplaceRenderer
              item={item}
              suppressClickRef={draggedRef}
              onAddToCart={() => { void fetch(API_PREFIX + '/cart/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId, itemId: item.id }) }).catch(() => {}) }}
              onOpenChat={() => { /* chat moved to settings card */ }}
              onClickThrough={() => { openClickThrough(item) }}
            />
          : <SimpleCreative
              item={item}
              suppressClickRef={draggedRef}
              onClick={() => { openClickThrough(item) }}
              onVideoError={() => { setVideoError(true) }}
              onVideoLoadedMetadata={onVideoLoadedMetadata}
            />
      )}

      {/*
        SE resize handle. Always rendered (not gated on item
        presence) so the user can resize the empty state surface
        too — that path matters for hosts that disable
        `display.size` programmatically and want to verify the
        user-visible width via the handle. The `data-dsh-resize-
        handle` attribute is what the parent widget's
        onPointerDown checks to skip the drag gesture (defense in
        depth — the handle's own onPointerDown also calls
        stopPropagation). `tabIndex={0}` makes the button
        keyboard-focusable; ARIA label is read by screen readers
        and shown in the browser's title tooltip.
      */}
      <button
        type="button"
        className={styles.resizeHandle}
        data-dsh-resize-handle="1"
        data-resizing={resizeSize === null ? 'false' : 'true'}
        aria-label={t('ad.widget.resizeHint')}
        title={t('ad.widget.resizeHint')}
        tabIndex={0}
        onPointerDown={onPointerDownResize}
        onKeyDown={onResizeKeyDown}
        onClick={(e) => { e.stopPropagation() }}
      >
        <span className={styles.resizeGlyph} aria-hidden="true" />
      </button>
    </div>
  )
}

function clampPx(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  const rounded = Math.round(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}
