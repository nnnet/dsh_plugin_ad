/**
 * The floating ad widget: cycles through the active source's feed and
 * routes each item to the right renderer — a simple `SimpleCreative` for
 * video/gif/image/text/message/html/card/raw items, a full
 * `MarketplaceRenderer` for product cards, and an optional `ChatPanel`
 * when the source has chat configured (with live token streaming when
 * `chat.streaming: true`).
 *
 * The widget talks to the host only through the same `/api/ad/*` JSON API
 * the routes module exposes; it never sees the source's raw `AdSourceConfig`
 * or its credentials, only the credential-free `AdSourceView` /
 * `AdItemView` shapes.
 * @module dsh_plugin_ad/client/AdWidget
 */

import { useEffect, useRef, useState } from 'react'
import { SimpleCreative } from './SimpleCreative.tsx'
import { MarketplaceRenderer } from './MarketplaceRenderer.tsx'
import { ChatPanel } from './ChatPanel.tsx'
import { CartDrawer } from './CartDrawer.tsx'
import { t } from './locales.ts'
import { API_PREFIX as API_PATH, WIDGET_ROTATION_MS } from './constants.ts'
import type { AdItemView, AdRuntimeContext, SourceView, CartLineView } from './types.ts'
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

  useEffect(() => {
    adFetch<SourceView[]>(API_PREFIX + '/sources', { ...runtimeContext() }).then((list) => {
      const first = list.find((s) => s.id !== undefined && s.eligible) ?? list[0]
      setSources(list)
      if (first !== undefined) setSourceId(first.id)
    }, () => { setFailed(true) })
  }, [])

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

  const refreshCart = (): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>(API_PREFIX + '/cart').then((res) => {
      if (res.ok) {
        setCartLines(res.lines)
        setCartTotal(res.total)
      }
    }, () => {})
  }

  useEffect(() => {
    fetchNext()
    refreshCart()
    const interval = setInterval(fetchNext, WIDGET_ROTATION_MS)
    return () => { clearInterval(interval) }
  }, [sourceId])

  const active = sources.find((s) => s.id === sourceId)

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
      sourceId,
      itemId,
      qty,
    }).then((res) => { if (res.ok) { setCartLines(res.lines); setCartTotal(res.total) } }, () => {})
  }

  const removeLine = (itemId: string): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>(API_PREFIX + '/cart/remove', {
      sourceId,
      itemId,
    }).then((res) => { if (res.ok) { setCartLines(res.lines); setCartTotal(res.total) } }, () => {})
  }

  const clearCart = (): void => {
    adFetch<{ ok: true; lines: CartLineView[] }>(API_PREFIX + '/cart/clear', { sourceId }).then((res) => {
      if (res.ok) { setCartLines(res.lines); setCartTotal(undefined) }
    }, () => {})
  }

  return (
    <div className={styles.widget}>
      <div className={styles.header}>
        <span className={styles.title}>{t('ad.widget.title')}</span>
        {sources.length > 1 && (
          <select
            className={styles.sourcePicker}
            value={sourceId}
            onChange={(e) => { setSourceId(e.target.value); setShowChat(false) }}
            aria-label={t('ad.widget.sourcePicker')}
          >
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}{s.eligible ? '' : ' *'}</option>)}
          </select>
        )}
        <button
          className={styles.cartToggle}
          onClick={() => { setShowCart((v) => !v) }}
          aria-label={t('ad.cart.title')}
        >
          🛒{cartLines.length > 0 && <span className={styles.cartBadge}>{cartLines.length}</span>}
        </button>
        <button className={styles.refresh} onClick={fetchNext} aria-label={t('ad.widget.refresh')}>↻</button>
      </div>

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
                ? <MarketplaceRenderer item={item} campaignLabel={active?.campaignLabel} onAddToCart={addToCart} onOpenChat={() => { setShowChat(true) }} />
                : <SimpleCreative item={item} />
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
