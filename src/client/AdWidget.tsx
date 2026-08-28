/**
 * The floating ad widget (v0.2): cycles through the active source's feed
 * and renders whichever shape the current item is — a simple video/gif/
 * image/text/message creative (v0.1 behavior, unchanged) or a full product
 * card with a media carousel, price/discount, CTA buttons, expandable
 * details, and a cart — plus, when the source has one, a chat panel backed
 * by the source's AI assistant, now with live token streaming. The item and
 * source shapes still come from the exact same `AdSourceConfig`/`AdItem`
 * contract as v0.1: nothing here required a config change, only richer
 * normalization on the host side (see adapter.ts) and richer rendering here.
 * @module @linxin666/dsh-ad/client/AdWidget
 */

import { useEffect, useRef, useState } from 'react'
import { t } from './locales.ts'
import { ProductCarousel } from './ProductCarousel.tsx'
import { PriceTag } from './PriceTag.tsx'
import { CtaRow } from './CtaRow.tsx'
import { ProductDetails } from './ProductDetails.tsx'
import { CartDrawer, type CartLineView } from './CartDrawer.tsx'
import styles from './ad.module.css'

// --- Shapes mirrored from the host's adapter.ts (kept here so the client
// bundle has no host-only import). Any field added there is optional here
// too, so a widget built against an older host still compiles and renders
// the fields it knows about.

export interface AdMedia {
  kind: 'video' | 'gif' | 'image'
  url: string
  thumbnailUrl?: string
}

export interface AdPrice {
  amount: number
  currency: string
  originalAmount?: number
  discountPercent?: number
}

export interface AdCta {
  id: string
  label: string
  kind: 'buy' | 'cart' | 'link' | 'chat'
  url?: string
}

export interface AdDetails {
  description?: string
  specs?: Record<string, string>
}

/** One normalized ad item as the browser receives it (credential-free). */
export interface AdItemView {
  id: string
  type: 'video' | 'gif' | 'image' | 'text' | 'message' | 'product'
  title?: string
  body?: string
  mediaUrl?: string
  media?: AdMedia[]
  price?: AdPrice
  ctas?: AdCta[]
  details?: AdDetails
  clickUrl?: string
}

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

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

/** Open a click-through URL the way a normal outbound ad link would. */
function openClickThrough(url: string | undefined): void {
  if (url === undefined || url === '') return
  window.open(url, '_blank', 'noopener,noreferrer')
}

// --- Simple (non-product) creative, unchanged from v0.1 -------------------

function SimpleCreative({ item }: { item: AdItemView }): React.ReactElement {
  const clickable = item.clickUrl !== undefined && item.clickUrl !== ''
  const onClick = (): void => { openClickThrough(item.clickUrl) }

  switch (item.type) {
    case 'video':
      return (
        <video
          className={styles.media}
          src={item.mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          onClick={clickable ? onClick : undefined}
          title={clickable ? t('ad.widget.clickHint') : undefined}
        />
      )
    case 'gif':
    case 'image':
      return (
        <img
          className={styles.media}
          src={item.mediaUrl}
          alt={item.title ?? ''}
          onClick={clickable ? onClick : undefined}
          title={clickable ? t('ad.widget.clickHint') : undefined}
        />
      )
    case 'message':
    case 'text':
    default:
      return (
        <div className={styles.textCard} onClick={clickable ? onClick : undefined}>
          {item.title !== undefined && <div className={styles.textTitle}>{item.title}</div>}
          {item.body !== undefined && <div className={styles.textBody}>{item.body}</div>}
        </div>
      )
  }
}

// --- Full product card (v0.2) ----------------------------------------------

function ProductCard({
  item,
  onAddToCart,
  onOpenChat,
}: {
  item: AdItemView
  onAddToCart: (item: AdItemView) => void
  onOpenChat: () => void
}): React.ReactElement {
  return (
    <div className={styles.productCard}>
      {item.media !== undefined && item.media.length > 0 && (
        <ProductCarousel media={item.media} onActivate={() => { openClickThrough(item.clickUrl) }} />
      )}
      <div className={styles.productBody}>
        {item.title !== undefined && <div className={styles.productTitle}>{item.title}</div>}
        {item.body !== undefined && <div className={styles.productSummary}>{item.body}</div>}
        {item.price !== undefined && <PriceTag price={item.price} />}
        {item.details !== undefined && <ProductDetails details={item.details} />}
        {item.ctas !== undefined && item.ctas.length > 0 && (
          <CtaRow
            ctas={item.ctas}
            fallbackUrl={item.clickUrl}
            onBuyOrLink={openClickThrough}
            onAddToCart={() => { onAddToCart(item) }}
            onOpenChat={onOpenChat}
          />
        )}
      </div>
    </div>
  )
}

// --- Chat panel (v0.2: streaming) ------------------------------------------

/**
 * Read an SSE response body incrementally, invoking `onDelta` per token and
 * resolving once an `event: done` frame arrives (or the stream ends).
 * Rejects on an `event: error` frame or a network failure.
 */
async function readSseStream(response: Response, onDelta: (delta: string) => void): Promise<void> {
  if (response.body === null) throw new Error('no-stream-body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'

  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const lines = frame.split('\n')
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (event === 'error') throw new Error((JSON.parse(data || '{}') as { error?: string }).error ?? 'stream-error')
      if (event === 'done') return
      if (data !== '') {
        try {
          const parsed = JSON.parse(data) as { delta?: string }
          if (typeof parsed.delta === 'string') onDelta(parsed.delta)
        } catch { /* ignore malformed frame */ }
      }
    }
  }
}

function ChatPanel({ sourceId, streaming }: { sourceId: string; streaming: boolean }): React.ReactElement {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns])

  const sendStreaming = (message: string, history: ChatTurn[]): void => {
    let assistantIndex = -1
    fetch('/api/ad/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId, message, history }),
    }).then(async (response) => {
      setTurns((prev) => {
        assistantIndex = prev.length
        return [...prev, { role: 'assistant', content: '' }]
      })
      await readSseStream(response, (delta) => {
        setTurns((prev) => {
          const copy = [...prev]
          copy[assistantIndex] = { role: 'assistant', content: (copy[assistantIndex]?.content ?? '') + delta }
          return copy
        })
      })
      setSending(false)
    }).catch(() => {
      setSending(false)
      setError(true)
    })
  }

  const sendNonStreaming = (message: string, history: ChatTurn[], nextTurns: ChatTurn[]): void => {
    adFetch<{ ok: true; reply: string } | { ok: false; error: string }>('/api/ad/chat', {
      sourceId,
      message,
      history,
    }).then((res) => {
      setSending(false)
      if (res.ok) setTurns([...nextTurns, { role: 'assistant', content: res.reply }])
      else setError(true)
    }, () => {
      setSending(false)
      setError(true)
    })
  }

  const send = (): void => {
    const message = draft.trim()
    if (message === '' || sending) return
    setDraft('')
    setError(false)
    const history = turns
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', content: message }]
    setTurns(nextTurns)
    setSending(true)
    if (streaming) sendStreaming(message, history)
    else sendNonStreaming(message, history, nextTurns)
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatHeader}>{t('ad.chat.title')}</div>
      <div className={styles.chatList} ref={listRef}>
        {turns.length === 0 && <div className={styles.chatEmpty}>{t('ad.chat.emptyState')}</div>}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant}>
            {turn.content}
            {streaming && sending && turn.role === 'assistant' && i === turns.length - 1 && (
              <span className={styles.chatTypingDot}>{t('ad.chat.streaming')}</span>
            )}
          </div>
        ))}
        {error && <div className={styles.chatError}>{t('ad.chat.error')}</div>}
      </div>
      <div className={styles.chatInputRow}>
        <input
          className={styles.chatInput}
          value={draft}
          placeholder={t('ad.chat.placeholder')}
          onChange={(e) => { setDraft(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          disabled={sending}
        />
        <button className={styles.chatSend} onClick={send} disabled={sending || draft.trim() === ''}>
          {sending ? t('ad.chat.sending') : t('ad.chat.send')}
        </button>
      </div>
    </div>
  )
}

// --- Top-level widget --------------------------------------------------

interface SourceView { id: string; name: string; hasChat: boolean; chatStreaming?: boolean }

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
    adFetch<SourceView[]>('/api/ad/sources').then((list) => {
      setSources(list)
      if (list.length > 0) setSourceId(list[0].id)
    }, () => { setFailed(true) })
  }, [])

  const fetchNext = (): void => {
    adFetch<{ ok: true; item: AdItemView | null } | { ok: false; error: string }>(
      '/api/ad/next',
      sourceId === undefined ? undefined : { sourceId },
    ).then((res) => {
      if (res.ok) setItem(res.item)
      else setFailed(true)
    }, () => { setFailed(true) })
  }

  const refreshCart = (): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>('/api/ad/cart').then((res) => {
      if (res.ok) {
        setCartLines(res.lines)
        setCartTotal(res.total)
      }
    }, () => {})
  }

  useEffect(() => {
    fetchNext()
    refreshCart()
    const interval = setInterval(fetchNext, 15_000)
    return () => { clearInterval(interval) }
  }, [sourceId])

  const active = sources.find((s) => s.id === sourceId)

  const addToCart = (target: AdItemView): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>('/api/ad/cart/add', {
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
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>('/api/ad/cart/qty', {
      sourceId,
      itemId,
      qty,
    }).then((res) => { if (res.ok) { setCartLines(res.lines); setCartTotal(res.total) } }, () => {})
  }

  const removeLine = (itemId: string): void => {
    adFetch<{ ok: true; lines: CartLineView[]; total?: { amount: number; currency: string } }>('/api/ad/cart/remove', {
      sourceId,
      itemId,
    }).then((res) => { if (res.ok) { setCartLines(res.lines); setCartTotal(res.total) } }, () => {})
  }

  const clearCart = (): void => {
    adFetch<{ ok: true; lines: CartLineView[] }>('/api/ad/cart/clear', { sourceId }).then((res) => {
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
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                ? <ProductCard item={item} onAddToCart={addToCart} onOpenChat={() => { setShowChat(true) }} />
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
