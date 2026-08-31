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
import type {
  AdItemView,
  AdRuntimeContext,
  SourceView,
  DisplayView,
  SourcesResponse,
} from './types.ts'
import styles from './ad.module.css'

const API_PREFIX = API_PATH

async function adFetch<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined
    ? {}
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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

export function AdWidget(): React.ReactElement {
  const [sources, setSources] = useState<SourceView[]>([])
  const [sourceId, setSourceId] = useState<string | undefined>(undefined)
  const [item, setItem] = useState<AdItemView | null | undefined>(undefined)
  const [display, setDisplay] = useState<DisplayView>(DEFAULT_DISPLAY)
  const [pluginEnabled, setPluginEnabled] = useState(true)
  const [videoError, setVideoError] = useState(false)

  // --- Display fetch (initial + on settings change) -----------------------

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

  const fetchNext = (): void => {
    adFetch<{ ok: true; item: AdItemView | null } | { ok: false; error: string }>(
      API_PREFIX + '/next',
      sourceId === undefined ? { ...runtimeContext() } : { sourceId, ...runtimeContext() },
    ).then((res) => {
      if (res.ok) {
        setItem(res.item)
        if (res.item !== null) {
          void fetch(API_PREFIX + '/impression', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceId, itemId: res.item.id }),
          }).catch(() => {})
        } else {
          console.info('[dsh-ad] /next returned no item for source:', sourceId)
        }
      } else {
        console.info('[dsh-ad] /next returned error:', res.error)
      }
    }, () => { console.info('[dsh-ad] /next fetch rejected for source:', sourceId) })
  }

  useEffect(() => {
    fetchNext()
  }, [sourceId])

  useEffect(() => {
    // The host can override the auto-rotation interval via
    // `display.rotationMs` (set from AdSettingsCard). Falls back to
    // the client-side constant when the host doesn't override.
    const intervalMs = display.rotationMs ?? WIDGET_ROTATION_MS
    const interval = setInterval(fetchNext, intervalMs)
    return () => { clearInterval(interval) }
  }, [sourceId, display.rotationMs])

  /**
   * Manually step the rotation by `delta` items (±1) without waiting
   * for the auto-rotation timer. Used by the prev/next nav buttons.
   * Skips the impression fetch — the server records the impression
   * on `nextItem` itself, so the manual call counts as a normal
   * rotation tick from the host's perspective.
   */
  const goRelative = useCallback((delta: -1 | 1): void => {
    adFetch<{ ok: true; item: AdItemView | null } | { ok: false; error: string }>(
      API_PREFIX + '/next',
      { sourceId, delta, ...runtimeContext() },
    ).then((res) => {
      if (res.ok) {
        setItem(res.item)
      } else {
        console.info('[dsh-ad] /next returned error:', res.error)
      }
    }, () => { console.info('[dsh-ad] /next fetch rejected for source:', sourceId) })
  }, [sourceId])

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

  /** Snapshot of the press: where the pointer started, plus the host
   *  position at that moment. Immutable for the duration of the
   *  gesture — recomputing from this snapshot each frame is what makes
   *  the cursor follow 1:1. */
  const dragRef = useRef<{ startX: number; startY: number; right: number; bottom: number; pointerId: number } | null>(null)
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

  const onPointerDownWidget = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    // Don't start a drag from interactive children — a press on the
    // prev/next buttons, source <select>, or video controls should
    // pass through to their own click handlers.
    if ((e.target as HTMLElement).closest('button, select, input, a, video[controls]') !== null) return
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
      if (drag === null) return
      if (drag.pointerId !== e.pointerId) return
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
    }
    const finishGesture = (pointerId: number, committed: boolean): void => {
      const drag = dragRef.current
      if (drag === null) return
      if (drag.pointerId !== pointerId) return
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
    }
    const onUp = (e: PointerEvent): void => { finishGesture(e.pointerId, true) }
    // Safety net: if the browser revokes capture (e.g. the user
    // releases outside any element we control, or a focus shift kills
    // the gesture), `lostpointercapture` fires and we still tear down
    // — this is the path that fixes the "cursor stuck" bug. Capture is
    // implicitly released after a normal pointerup, so this listener
    // is mostly redundant for happy-path gestures, but it's the one
    // that catches the edge case.
    const onLostCapture = (e: PointerEvent): void => { finishGesture(e.pointerId, false) }
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
  const widgetStyle: React.CSSProperties = {
    width: display.size >= 200 ? `${display.size}px` : undefined,
    maxWidth: 'calc(100vw - 32px)',
    minWidth: '120px',
    minHeight: '120px',
    right: `${renderedPos.right}px`,
    bottom: `${renderedPos.bottom}px`,
    cursor: dragPos === null ? 'grab' : 'grabbing',
    touchAction: 'none',
  }

  return (
    <div
      ref={widgetRef}
      className={styles.widget}
      style={widgetStyle}
      data-dsh-ad-size={display.size}
      data-dsh-ad-enabled={display.enabled ? '1' : '0'}
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
          : <SimpleCreative item={item} suppressClickRef={draggedRef} onClick={() => { openClickThrough(item) }} onVideoError={() => { setVideoError(true) }} />
      )}
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
