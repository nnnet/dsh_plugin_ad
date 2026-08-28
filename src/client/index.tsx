import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { en, zh, t as translate, NS } from '../locales/index.ts'
import { API_PREFIX, MEDIA_PREFIX } from '../constants.ts'
import type { AdItem, AdSnapshot } from '../service.ts'

interface ApiState extends AdSnapshot {}
interface ChatMessage { role: 'user' | 'assistant'; content: string }

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`ad-pet ${response.status}`)
  return response.json() as Promise<T>
}

function useLanguage(): string {
  const [lang, setLang] = useState(() => typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en')
  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => setLang(document.documentElement.lang || 'en')
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, [])
  return lang
}

function anonymousSessionId(): string {
  try {
    const key = 'dsh-ad-pet-session'
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const value = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem(key, value)
    return value
  } catch { return 'ephemeral' }
}

function mediaUrl(sourceId: string, value: string): string {
  return `${MEDIA_PREFIX}?source=${encodeURIComponent(sourceId)}&url=${encodeURIComponent(value)}`
}

function ProductGallery({ sourceId, item }: { sourceId: string; item: AdItem }) {
  const images = [item.image, ...(item.gallery ?? [])].filter((v, i, a): v is string => !!v && a.indexOf(v) === i).slice(0, 12)
  const [selected, setSelected] = useState(0)
  if (!images.length && !item.media) return null
  const source = images[selected] ?? item.media
  if (!source) return null
  const video = item.type === 'video' || /\.(mp4|webm|mov)(?:$|\?)/i.test(source)
  return <div>
    {video
      ? <video src={mediaUrl(sourceId, source)} controls playsInline muted style={{ width: '100%', borderRadius: 12, maxHeight: 290, display: 'block' }} />
      : <img src={mediaUrl(sourceId, source)} alt={item.title ?? ''} style={{ width: '100%', borderRadius: 12, maxHeight: 290, objectFit: 'cover', display: 'block' }} />}
    {images.length > 1 && <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 6 }}>
      {images.map((image, i) => <button key={image} onClick={() => setSelected(i)} aria-label={`${i + 1}`} style={{ padding: 0, border: i === selected ? '2px solid currentColor' : '1px solid #ddd', borderRadius: 7, background: 'transparent' }}>
        <img src={mediaUrl(sourceId, image)} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
      </button>)}
    </div>}
  </div>
}

function Price({ item, lang }: { item: AdItem; lang: string }) {
  if (item.price === undefined && item.originalPrice === undefined) return null
  const price = item.price === undefined ? '' : `${item.price} ${item.currency ?? ''}`.trim()
  const old = item.originalPrice === undefined ? '' : `${item.originalPrice} ${item.currency ?? ''}`.trim()
  return <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
    {price && <strong style={{ fontSize: 21 }}>{price}</strong>}
    {old && <span style={{ textDecoration: 'line-through', opacity: .55 }}>{old}</span>}
    {item.discount !== undefined && <span style={{ fontSize: 12, fontWeight: 700 }}>{translate('ad.discount', { value: item.discount }, lang)}</span>}
  </div>
}

function Chat({ sourceId, item, lang }: { sourceId: string; item: AdItem; lang: string }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('')
  if (!item.assistantId) return null

  const send = async () => {
    const current = message.trim()
    if (!current || busy) return
    const next = [...messages, { role: 'user' as const, content: current }]
    setMessages(next); setMessage(''); setBusy(true); setStreaming('')
    try {
      const response = await fetch(`${API_PREFIX}/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId, assistantId: item.assistantId, productId: item.productId, sessionId: anonymousSessionId(), message: current, history: next, locale: lang }) })
      if (!response.ok || !response.body) throw new Error('stream unavailable')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''
      while (true) {
        const part = await reader.read()
        if (part.done) break
        buffer += decoder.decode(part.value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload) as { text?: string; delta?: string; content?: string; answer?: string }
            const chunk = parsed.delta ?? parsed.text ?? parsed.content ?? parsed.answer ?? ''
            if (chunk) { accumulated += chunk; setStreaming(accumulated) }
          } catch {
            if (payload) { accumulated += payload; setStreaming(accumulated) }
          }
        }
      }
      if (accumulated) setMessages((items) => [...items, { role: 'assistant', content: accumulated }])
    } catch {
      setMessages((items) => [...items, { role: 'assistant', content: translate('ad.chatError', undefined, lang) }])
    } finally { setStreaming(''); setBusy(false) }
  }

  return <div style={{ marginTop: 10 }}>
    <button onClick={() => setOpen(!open)}>{translate('ad.chat', undefined, lang)}</button>
    {open && <div style={{ marginTop: 8, padding: 9, borderRadius: 10, background: '#f5f5f5' }}>
      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.map((entry, i) => <div key={i} style={{ alignSelf: entry.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%', padding: '6px 8px', borderRadius: 8, background: entry.role === 'user' ? '#e8e8e8' : 'white' }}>{entry.content}</div>)}
        {streaming && <div style={{ alignSelf: 'flex-start', maxWidth: '90%', padding: '6px 8px', borderRadius: 8, background: 'white' }}>{streaming}</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
        <input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send() }} placeholder={translate('ad.chatPlaceholder', undefined, lang)} style={{ flex: 1, minWidth: 0 }} />
        <button onClick={() => void send()} disabled={busy}>{busy ? translate('ad.chatThinking', undefined, lang) : translate('ad.chatSend', undefined, lang)}</button>
      </div>
    </div>}
  </div>
}

function track(sourceId: string, event: 'impression' | 'click' | 'conversion', payload: Record<string, unknown>): void {
  void api(`${API_PREFIX}/track`, { sourceId, event, payload }).catch(() => undefined)
}

function ActionButton({ sourceId, actionId, payload, label, onResult }: { sourceId: string; actionId?: string; payload: Record<string, unknown>; label: string; onResult?: (value: unknown) => void }) {
  if (!actionId) return null
  const run = async () => {
    try { const result = await api<unknown>(`${API_PREFIX}/action`, { sourceId, actionId, payload }); onResult?.(result) }
    catch { onResult?.(null) }
  }
  return <button onClick={() => { track(sourceId, 'click', { actionId, productId: payload.productId, campaignId: payload.campaignId, locale: payload.locale, sessionId: anonymousSessionId() }); void run() }} style={{ flex: 1 }}>{label}</button>
}

function AdCard({ sourceId, item, lang, onClose }: { sourceId: string; item: AdItem; lang: string; onClose: () => void }) {
  const [details, setDetails] = useState<unknown>()
  useEffect(() => {
    track(sourceId, 'impression', { adId: item.id, campaignId: item.campaignId, creativeId: item.creativeId, variant: item.variant, productId: item.productId, locale: lang, sessionId: anonymousSessionId() })
  }, [sourceId, item.id, item.campaignId, item.creativeId, item.variant, item.productId, lang])
  return <div style={{ width: 360, maxWidth: 'calc(100vw - 28px)', maxHeight: 'min(78vh, 760px)', overflowY: 'auto', background: 'white', color: '#111', borderRadius: 16, boxShadow: '0 10px 35px rgba(0,0,0,.22)', padding: 12, fontFamily: 'system-ui, sans-serif' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12, opacity: .72 }}>
      <span>{item.badge ?? translate('ad.sponsored', undefined, lang)}</span><button aria-label={translate('ad.close', undefined, lang)} onClick={onClose}>×</button>
    </div>
    <ProductGallery sourceId={sourceId} item={item} />
    {item.brand && <div style={{ marginTop: 8, fontSize: 12, opacity: .65 }}>{item.brand}</div>}
    {item.title && <div style={{ fontSize: 18, fontWeight: 750, marginTop: 3 }}>{item.title}</div>}
    {item.rating !== undefined && <div style={{ marginTop: 4, fontSize: 13 }}>★ {item.rating}</div>}
    <Price item={item} lang={lang} />
    {item.text && <div style={{ marginTop: 7, lineHeight: 1.45 }}>{item.text}</div>}
    {item.description && <div style={{ marginTop: 6, fontSize: 13, opacity: .72 }}>{item.description}</div>}
    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
      <ActionButton sourceId={sourceId} actionId={item.detailsActionId} payload={{ productId: item.productId, sku: item.sku, campaignId: item.campaignId, locale: lang }} label={translate('ad.details', undefined, lang)} onResult={setDetails} />
      <ActionButton sourceId={sourceId} actionId={item.cartActionId} payload={{ productId: item.productId, sku: item.sku, campaignId: item.campaignId, locale: lang }} label={translate('ad.addToCart', undefined, lang)} />
      <ActionButton sourceId={sourceId} actionId={item.checkoutActionId} payload={{ productId: item.productId, sku: item.sku, campaignId: item.campaignId, locale: lang }} label={translate('ad.checkout', undefined, lang)} onResult={(result) => { if (result !== null) track(sourceId, 'conversion', { adId: item.id, campaignId: item.campaignId, creativeId: item.creativeId, productId: item.productId, locale: lang, sessionId: anonymousSessionId() }) }} />
      {item.url && <button onClick={() => { track(sourceId, 'click', { adId: item.id, campaignId: item.campaignId, creativeId: item.creativeId, productId: item.productId, locale: lang, sessionId: anonymousSessionId() }); window.open(item.url, '_blank', 'noopener,noreferrer') }} style={{ flex: 1 }}>{translate('ad.open', undefined, lang)}</button>}
    </div>
    {details !== undefined && <pre style={{ marginTop: 8, padding: 8, background: '#f5f5f5', borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 180, overflow: 'auto' }}>{JSON.stringify(details, null, 2)}</pre>}
    <Chat sourceId={sourceId} item={item} lang={lang} />
  </div>
}

function AdPet() {
  const lang = useLanguage()
  const [snapshot, setSnapshot] = useState<ApiState>({ fetchedAt: 0, items: [] })
  const [index, setIndex] = useState(0)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let alive = true
    const load = async () => { try { const value = await api<ApiState>(`${API_PREFIX}/refresh`, { locale: lang, path: window.location.pathname, tags: [] }); if (alive) setSnapshot(value) } catch { try { const value = await api<ApiState>(`${API_PREFIX}/state`); if (alive) setSnapshot(value) } catch {} } }
    void load()
    const timer = window.setInterval(load, 60_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [lang])
  const item = useMemo(() => snapshot.items[index % Math.max(snapshot.items.length, 1)], [snapshot.items, index])
  if (hidden) return <button onClick={() => setHidden(false)} style={{ position: 'fixed', right: 20, bottom: 90, zIndex: 2147483647, border: 0, background: 'transparent', fontSize: 42, cursor: 'pointer' }} title={translate('ad.title', undefined, lang)}>🐾</button>
  return <div data-dsh-ad-pet-root style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 2147483647, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {item ? <AdCard sourceId={snapshot.sourceId ?? ''} item={item} lang={lang} onClose={() => setHidden(true)} /> : <div style={{ background: 'white', borderRadius: 12, padding: 12 }}>{translate('ad.noContent', undefined, lang)}</div>}
      {snapshot.items.length > 1 && <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}><button onClick={() => setIndex((v) => (v - 1 + snapshot.items.length) % snapshot.items.length)}>{translate('ad.previous', undefined, lang)}</button><span style={{ padding: '5px 2px', fontSize: 12, opacity: .7 }}>{index + 1}/{snapshot.items.length}</span><button onClick={() => setIndex((v) => (v + 1) % snapshot.items.length)}>{translate('ad.next', undefined, lang)}</button></div>}
    </div>
    <div title={translate('ad.poweredBy', undefined, lang)} style={{ fontSize: 46, filter: 'drop-shadow(0 5px 8px rgba(0,0,0,.2))' }}>🐾</div>
  </div>
}

export const inject = ['locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try { return ctx.locale.register(NS, { en, zh }) } catch { return () => {} }
  }, 'ad-pet: dictionaries')
  ctx.effect(() => {
    const container = document.createElement('div')
    container.dataset.dshAdPetRoot = ''
    document.body.appendChild(container)
    const root = createRoot(container)
    root.render(createElement(AdPet))
    return () => { root.unmount(); container.remove() }
  }, 'ad-pet: ui')
}
