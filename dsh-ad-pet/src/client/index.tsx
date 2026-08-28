import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { en, zh, t as translate } from '../locales/index.ts'
import { NS } from '../locales/index.ts'
import { API_PREFIX, MEDIA_PREFIX } from '../constants.ts'
import type { AdItem, AdSnapshot } from '../service.ts'

interface ApiState extends AdSnapshot {}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`ad-pet ${response.status}`)
  return response.json() as Promise<T>
}

function useLanguage(): string {
  const [lang, setLang] = useState(() => typeof document === 'undefined' ? 'en' : document.documentElement.lang)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => setLang(document.documentElement.lang))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => observer.disconnect()
  }, [])
  return lang
}

function mediaUrl(sourceId: string, value: string): string {
  return `${MEDIA_PREFIX}?source=${encodeURIComponent(sourceId)}&url=${encodeURIComponent(value)}`
}

function AdMedia({ sourceId, item }: { sourceId: string; item: AdItem }) {
  const source = item.media ?? item.image
  if (!source) return null
  const src = mediaUrl(sourceId, source)
  if (item.type === 'video' || /\.mp4(?:$|\?)/i.test(source)) return <video src={src} controls playsInline muted style={{ width: '100%', borderRadius: 12, maxHeight: 280 }} />
  return <img src={src} alt={item.title ?? ''} style={{ width: '100%', borderRadius: 12, maxHeight: 280, objectFit: 'cover' }} />
}

function Chat({ sourceId, item, lang }: { sourceId: string; item: AdItem; lang: string }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [answer, setAnswer] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  if (!item.assistantId) return null
  const send = async () => {
    if (!message.trim() || busy) return
    const current = message.trim(); setMessage(''); setBusy(true)
    try {
      const result = await api<{ text?: string }>(`${API_PREFIX}/chat`, { sourceId, assistantId: item.assistantId, message: current, history: answer.map((text) => ({ role: 'assistant', content: text })), locale: lang })
      if (result.text) setAnswer((items) => [...items, result.text!])
    } catch { setAnswer((items) => [...items, translate('ad.chatError', undefined, lang)]) }
    finally { setBusy(false) }
  }
  return <div style={{ marginTop: 10 }}>
    <button onClick={() => setOpen(!open)}>{translate('ad.chat', undefined, lang)}</button>
    {open && <div style={{ marginTop: 8, padding: 8, borderRadius: 10, background: '#f5f5f5' }}>
      {answer.map((text, i) => <div key={i} style={{ padding: '4px 0' }}>{text}</div>)}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send() }} placeholder={translate('ad.chatPlaceholder', undefined, lang)} style={{ flex: 1 }} />
        <button onClick={() => void send()} disabled={busy}>{busy ? translate('ad.chatThinking', undefined, lang) : translate('ad.chatSend', undefined, lang)}</button>
      </div>
    </div>}
  </div>
}

function AdCard({ sourceId, item, lang, onClose }: { sourceId: string; item: AdItem; lang: string; onClose: () => void }) {
  return <div style={{ width: 330, maxWidth: 'calc(100vw - 28px)', background: 'white', color: '#111', borderRadius: 16, boxShadow: '0 10px 35px rgba(0,0,0,.22)', padding: 12, fontFamily: 'system-ui, sans-serif' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, opacity: .7 }}>
      <span>{translate('ad.sponsored', undefined, lang)}</span><button aria-label={translate('ad.close', undefined, lang)} onClick={onClose}>×</button>
    </div>
    <AdMedia sourceId={sourceId} item={item} />
    {item.title && <div style={{ fontSize: 17, fontWeight: 700, marginTop: 8 }}>{item.title}</div>}
    {item.text && <div style={{ marginTop: 6, lineHeight: 1.45 }}>{item.text}</div>}
    {item.description && <div style={{ marginTop: 6, fontSize: 13, opacity: .72 }}>{item.description}</div>}
    <Chat sourceId={sourceId} item={item} lang={lang} />
    {item.url && <button onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')} style={{ marginTop: 10, width: '100%' }}>{translate('ad.open', undefined, lang)}</button>}
  </div>
}

function AdPet() {
  const lang = useLanguage()
  const [snapshot, setSnapshot] = useState<ApiState>({ fetchedAt: 0, items: [] })
  const [index, setIndex] = useState(0)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let alive = true
    const load = async () => { try { const value = await api<ApiState>(`${API_PREFIX}/state`); if (alive) setSnapshot(value) } catch {} }
    void load()
    const timer = window.setInterval(load, 60_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])
  const item = useMemo(() => snapshot.items[index % Math.max(snapshot.items.length, 1)], [snapshot.items, index])
  if (hidden) return <button onClick={() => setHidden(false)} style={{ position: 'fixed', right: 20, bottom: 90, zIndex: 2147483647, border: 0, background: 'transparent', fontSize: 42, cursor: 'pointer' }} title={translate('ad.title', undefined, lang)}>🐾</button>
  return <div data-dsh-ad-pet-root style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 2147483647, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {item ? <AdCard sourceId={snapshot.sourceId ?? ''} item={item} lang={lang} onClose={() => setHidden(true)} /> : <div style={{ background: 'white', borderRadius: 12, padding: 12 }}>{translate('ad.noContent', undefined, lang)}</div>}
      {snapshot.items.length > 1 && <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}><button onClick={() => setIndex((v) => (v - 1 + snapshot.items.length) % snapshot.items.length)}>{translate('ad.previous', undefined, lang)}</button><button onClick={() => setIndex((v) => (v + 1) % snapshot.items.length)}>{translate('ad.next', undefined, lang)}</button></div>}
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
