/**
 * The floating ad widget: cycles through the active source's feed and
 * routes each item to the right renderer — a simple `SimpleCreative` for
 * video/gif/image/text/message/html/card/raw items, a full
 * `MarketplaceRenderer` for product cards, and an optional `ChatPanel`
 * when the source has chat configured (with live token streaming when
 * `chat.streaming: true`).
 *
 * Pet-style behaviour:
 *  - Drag the widget by its header to reposition it; the new right/bottom
 *    is persisted via `/api/ad/display` and applied to the inline style
 *    immediately.
 *  - Source picker appears on hover instead of taking a permanent header
 *    slot.
 *  - Display settings (size, right, bottom, enabled, visible,
 *    decorationEnabled) are read from the host's `/api/ad/sources`
 *    response, which is the canonical mirror of the `ad` settings
 *    document.
 *
 * Click-through: every card (marketplace or simple) opens the item's
 * `clickUrl` in a new tab via `window.open(url, '_blank', 'noopener')`.
 * MarketplaceRenderer already handles its own click on the primary CTA;
 * this widget also covers simple creatives and product carousel clicks.
 * @module dsh_plugin_ad/client/AdWidget
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { SimpleCreative } from './SimpleCreative.tsx'
import { MarketplaceRenderer } from './MarketplaceRenderer.tsx'
import { ChatPanel } from './ChatPanel.tsx'
import { CartDrawer } from './CartDrawer.tsx'
import { t } from './locales.ts'
import { API_PREFIX as API_PATH, WIDGET_ROTATION_MS } from './constants.ts'
import type {
  AdItemView,
  AdRuntimeContext,
  SourceView,
  CartLineView,
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
  size: 360,
  right: 24,
  bottom: 20,
}

export function AdWidget(): React.ReactElement {
  const [sources, setSources] = useState<SourceView[]>([])
  const [sourceId, setSourceId] = useState<string | undefined>(undefined)
  const [item, setItem] = useState<AdItemView | null | undefined>(undefined)
  const [showChat, setShowChat] = useState(false)
  const [showCart, setShowCart] = useState(false)
  const [failed, setFailed] = useState(false)
  const [cartLines, setCartLines] = useState<CartLineView[]>([])
  const [cartTotal, setCartTotal] = useState<{ amount: number; currency: string } | undefined>(undefined)
  const [addedFlash, setAddedFlash] = useState(false)
  const [display, setDisplay] = useState<DisplayView>(DEFAULT_DISPLAY)
  const [pluginEnabled, setPluginEnabled] = useState(true)
  const [hovered, setHovered] = useState(false)

  // --- Display fetch (initial + on settings change) -----------------------

  useEffect(() => {
    adFetch<SourcesResponse>(API_PREFIX + '/sources', { ...runtimeContext() }).then((res) => {
      const list = res.sources ?? []
      const first = list.find((s) => s.id !== undefined && s.eligible) ?? list[0]
      setSources(list)
      const targetSource = res.activeSourceId !== undefined && list.some(s => s.id === res.activeSourceId)
        ? res.activeSourceId
        : first?.id
      if (targetSource !== undefined) setSourceId(targetSource)
      if (res.display !== undefined) setDisplay({ ...DEFAULT_DISPLAY, ...res.display })
      if (typeof res.enabled === 'boolean') setPluginEnabled(res.enabled)
    }, () => { setFailed(true) })
  }, [])

  // --- Item rotation ------------------------------------------------------

  const fetchNext = (): void => {
    adFetch<{ ok: true; item: AdItemView | null } | { ok: false; error: string }>(
      API_PREFIX + '/next',
      sourceId === undefined ? { ...runtimeContext() } : { sourceId, ...runtimeContext() },
    ).then((res) => {
      if (res.ok) {
        setItem(res.item)
        if (res.item !== null) {
          // Best-effort impression beacon; failing must never block rotation.
          void fetch(API_PREFIX + '/impression', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceId, itemId: res.item.id }),
          }).catch(() => {})
        }
      } else setFailed(true)
    }, () => { setFailed(true) })
  }

  useEffect(() => {
    fetchNext()
    if (sourceId !== undefined) refreshCart()
  }, [sourceId])

  // Auto-rotation interval. We don't have rotationSec in display yet
  // (display is Pet-style now), so fall back to the WIDGET_ROTATION_MS
  // constant. Future: read rotation from a separate config endpoint.
  useEffect(() => {
    const interval = setInterval(fetchNext, WIDGET_ROTATION_MS)
    return () => { clearInterval(interval) }
  }, [sourceId])

  const refreshCart = (): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>(API_PREFIX + '/cart').then((res) => {
      if (res.ok) {
        setCartLines(res.lines)
        setCartTotal(res.total)
      }
    }, () => {})
  }

  const active = sources.find((s) => s.id === sourceId)

  // --- Drag-and-drop (Pet pattern) ---------------------------------------

  const dragRef = useRef<{ startX: number; startY: number; right: number; bottom: number } | null>(null)
  const draggedRef = useRef(false)

  const onPointerDownHeader = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary button drags; allow clicks on inner controls to fire.
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, select, input, a') !== null) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, right: display.right, bottom: display.bottom }
    draggedRef.current = false
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }, [display.right, display.bottom])

  const onPointerMoveHeader = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) draggedRef.current = true
    if (typeof window === 'undefined') return
    const widgetEl = e.currentTarget.parentElement
    const width = widgetEl?.offsetWidth ?? display.size
    const height = widgetEl?.offsetHeight ?? 200
    const nextRight = clampPx(drag.right - dx, 0, Math.max(0, window.innerWidth - width))
    const nextBottom = clampPx(drag.bottom - dy, 0, Math.max(0, window.innerHeight - height))
    setDisplay(prev => ({ ...prev, right: nextRight, bottom: nextBottom }))
  }, [display.size])

  const onPointerUpHeader = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return
    const drag = dragRef.current
    dragRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (!draggedRef.current) return
    // Persist the new position via the host.
    void adFetch<{ ok: true; display: DisplayView }>(API_PREFIX + '/display', {
      right: display.right,
      bottom: display.bottom,
    }).catch(() => {})
    void drag
  }, [display.right, display.bottom])

  // --- Click-through -----------------------------------------------------

  const openClickThrough = useCallback((item: AdItemView): void => {
    const url = item.clickUrl
    if (url === undefined || url === '') return
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      // No-op; the user can still navigate manually.
    }
  }, [])

  // --- Cart handlers -----------------------------------------------------

  const addToCart = (target: AdItemView): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>(API_PREFIX + '/cart/add', {
      sourceId,
      itemId: target.id,
    }).then((res) => {
      if (res.ok) {
        setCartLines(res.lines)
        setCartTotal(res.total)
        setAddedFlash(true)
        setTimeout(() => { setAddedFlash(false) }, 1500)
      }
    }, () => {})
  }

  const qtyChange = (itemId: string, qty: number): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>(API_PREFIX + '/cart/qty', {
      sourceId, itemId, qty,
    }).then((res) => { if (res.ok) { setCartLines(res.lines); setCartTotal(res.total) } }, () => {})
  }

  const removeLine = (itemId: string): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>(API_PREFIX + '/cart/remove', {
      sourceId, itemId,
    }).then((res) => { if (res.ok) { setCartLines(res.lines); setCartTotal(res.total) } }, () => {})
  }

  const clearCart = (): void => {
    adFetch<{ ok: true; lines: CartLineView[] }>(API_PREFIX + '/cart/clear', { sourceId }).then((res) => {
      if (res.ok) { setCartLines(res.lines); setCartTotal(undefined) }
    }, () => {})
  }

  // --- Visibility gating -------------------------------------------------

  if (!display.visible || !display.enabled || !pluginEnabled) {
    return <></>
  }

  const widgetStyle: React.CSSProperties = {
    width: `${display.size}px`,
    right: `${display.right}px`,
    bottom: `${display.bottom}px`,
  }

  return (
    <div
      className={`${styles.widget} ${hovered ? styles.widgetHovered ?? '' : ''}`.trim()}
      style={widgetStyle}
      data-dsh-ad-size={display.size}
      data-dsh-ad-enabled={display.enabled ? '1' : '0'}
      onMouseEnter={() => { setHovered(true) }}
      onMouseLeave={() => { setHovered(false) }}
    >
      <div
        className={styles.header}
        onPointerDown={onPointerDownHeader}
        onPointerMove={onPointerMoveHeader}
        onPointerUp={onPointerUpHeader}
        onPointerCancel={onPointerUpHeader}
      >
        <span className={styles.title}>{t('ad.widget.title')}</span>
        {display.decorationEnabled && active?.campaignLabel !== undefined && (
          <span className={styles.campaignBadge}>{active.campaignLabel}</span>
        )}
        <span className={styles.itemCount}>
          {active !== undefined ? t('ad.widget.itemCount', { n: active.itemCount }) : ''}
        </span>
        <button
          className={styles.cartToggle}
          onClick={() => { setShowCart((v) => !v) }}
          aria-label={t('ad.cart.title')}
        >
          🛒{cartLines.length > 0 && <span className={styles.cartBadge}>{cartLines.length}</span>}
        </button>
        <button className={styles.refresh} onClick={fetchNext} aria-label={t('ad.widget.refresh')}>↻</button>
      </div>

      {/* Source picker: appears on widget hover, not in the header permanently. */}
      {sources.length > 1 && (
        <div className={`${styles.sourceBar} ${hovered ? styles.sourceBarVisible ?? '' : ''}`.trim()}>
          {sources.map(s => (
            <button
              key={s.id}
              type="button"
              className={`${styles.sourcePill} ${s.id === sourceId ? styles.sourcePillActive ?? '' : ''} ${!s.eligible ? styles.sourcePillIneligible ?? '' : ''}`.trim()}
              onClick={() => { if (s.id !== sourceId) { setSourceId(s.id); setShowChat(false) } }}
              aria-pressed={s.id === sourceId}
            >
              {s.name}{!s.eligible ? ' *' : ''}
              <span className={styles.sourcePillCount}>{s.itemCount}</span>
            </button>
          ))}
        </div>
      )}

      {addedFlash && <div className={styles.addedFlash}>{t('ad.cart.added')}</div>}

      {active !== undefined && !active.eligible && (
        <div className={styles.ineligibleNote}>
          {active.ineligibleReason === 'frequency-cap'
            ? t('ad.widget.ineligibleFrequency')
            : t('ad.widget.ineligibleTargeting')}
        </div>
      )}

      {showCart
        ? (
          <CartDrawer lines={cartLines} total={cartTotal} onQtyChange={qtyChange} onRemove={removeLine} onClear={clearCart} />
          )
        : (
          <>
            {failed && <div className={styles.state}>{t('ad.widget.error')}</div>}
            {!failed && item === undefined && <div className={styles.state}>{t('ad.widget.loading')}</div>}
            {!failed && item === null && <div className={styles.state}>{t('ad.widget.empty')}</div>}
            {!failed && item !== undefined && item !== null && (
              item.type === 'product'
                ? <MarketplaceRenderer item={item} campaignLabel={active?.campaignLabel} onAddToCart={addToCart} onOpenChat={() => { setShowChat(true) }} onClickThrough={() => { openClickThrough(item) }} />
                : <SimpleCreative item={item} onClick={() => { openClickThrough(item) }} />
            )}

            {active?.hasChat === true && (
              <button className={styles.chatToggle} onClick={() => { setShowChat((v) => !v) }}>
                {t('ad.chat.title')}
              </button>
            )}
            {showChat && active?.hasChat === true && sourceId !== undefined && (
              <ChatPanel sourceId={sourceId} streaming={active.chatStreaming === true} />
            )}
          </>
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
