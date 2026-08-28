/**
 * Generic HTTP adapter for ad sources: substitutes `{placeholders}`, attaches
 * resolved credentials, performs the request, and extracts the configured
 * response path. Kept source-agnostic on purpose — a marketplace, a CDN, and
 * a bespoke ad server all speak through the same shape (see config.ts).
 * @module @linxin666/dsh-ad/adapter
 */

import type { AdEndpointConfig } from './config.ts'
import { type ResolvedAdCredentials } from './config.ts'

/** One media asset in a product's carousel. */
export interface AdMedia {
  kind: 'video' | 'gif' | 'image'
  url: string
  thumbnailUrl?: string
}

/** Price/discount block for a product card. */
export interface AdPrice {
  amount: number
  currency: string
  originalAmount?: number
  discountPercent?: number
}

/** One call-to-action button on a product card. */
export interface AdCta {
  id: string
  label: string
  kind: 'buy' | 'cart' | 'link' | 'chat'
  url?: string
}

/** Expandable product detail block (long description + spec table). */
export interface AdDetails {
  description?: string
  specs?: Record<string, string>
}

/**
 * One normalized ad item, regardless of which source produced it. `mediaUrl`
 * is kept for v0.1 renderers/backends (a single creative); `media` is the
 * v0.2 carousel form (zero or more videos/gifs/images) — both are populated
 * from the same feed record when possible, so nothing that read `mediaUrl`
 * before needs to change.
 */
export interface AdItem {
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
  /** Untouched source record, for renderers that need extra fields. */
  raw?: unknown
}

/** Substitute `{name}` placeholders in a string from a flat context object. */
export function fillTemplate(template: string, ctx: Record<string, string>): string {
  return template.replaceAll(/\{(\w+)\}/g, (whole, name: string) => ctx[name] ?? whole)
}

function fillDeep<T>(value: T, ctx: Record<string, string>): T {
  if (typeof value === 'string') return fillTemplate(value, ctx) as unknown as T
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, ctx)) as unknown as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = fillDeep(v, ctx)
    return out as unknown as T
  }
  return value
}

function readPath(payload: unknown, path: string | undefined): unknown {
  if (path === undefined || path === '') return payload
  let cursor: unknown = payload
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

function credentialHeaders(creds: ResolvedAdCredentials): Record<string, string> {
  const headers: Record<string, string> = {}
  if (creds.token !== undefined) headers.Authorization = `Bearer ${creds.token}`
  else if (creds.apiKey !== undefined) headers['X-Api-Key'] = creds.apiKey
  if (creds.login !== undefined && creds.password !== undefined) {
    headers.Authorization = `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString('base64')}`
  }
  return headers
}

/**
 * Perform one endpoint call, applying credentials, template substitution,
 * and the configured `responsePath` extraction.
 * @throws on network failure, non-2xx response, or a request that exceeds
 *   `endpoint.timeoutMs`.
 */
export async function callAdEndpoint(
  endpoint: AdEndpointConfig,
  creds: ResolvedAdCredentials,
  ctx: Record<string, string> = {},
): Promise<unknown> {
  const method = endpoint.method ?? 'GET'
  const url = new URL(fillTemplate(endpoint.url, ctx))
  for (const [key, value] of Object.entries(endpoint.params ?? {})) {
    url.searchParams.set(key, fillTemplate(value, ctx))
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...credentialHeaders(creds),
    ...(endpoint.headers ?? {}),
  }
  let body: string | undefined
  if (method !== 'GET' && endpoint.body !== undefined) {
    headers['content-type'] ??= 'application/json'
    body = JSON.stringify(fillDeep(endpoint.body, ctx))
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, endpoint.timeoutMs ?? 8000)
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal })
    if (!res.ok) throw new Error(`ad endpoint ${url.hostname} responded ${res.status}`)
    const payload: unknown = await res.json()
    return readPath(payload, endpoint.responsePath)
  } finally {
    clearTimeout(timeout)
  }
}

function mediaKindOf(url: string): AdMedia['kind'] {
  if (/\.mp4($|\?)/i.test(url)) return 'video'
  if (/\.gif($|\?)/i.test(url)) return 'gif'
  return 'image'
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Normalize a single media-list entry (string URL, or `{url, thumbnail}`-shaped object). */
function normalizeMediaEntry(entry: unknown): AdMedia | undefined {
  if (typeof entry === 'string') return { kind: mediaKindOf(entry), url: entry }
  if (entry !== null && typeof entry === 'object') {
    const e = entry as Record<string, unknown>
    const url = str(e.url) ?? str(e.src) ?? str(e.mediaUrl)
    if (url === undefined) return undefined
    const kindStr = str(e.kind) ?? str(e.type)
    const kind = kindStr === 'video' || kindStr === 'gif' || kindStr === 'image' ? kindStr : mediaKindOf(url)
    return { kind, url, thumbnailUrl: str(e.thumbnail) ?? str(e.thumbnailUrl) }
  }
  return undefined
}

/** Collect a product's media carousel from any of several common field names. */
function normalizeMedia(r: Record<string, unknown>): AdMedia[] {
  const buckets = [r.media, r.gallery, r.videos, r.images, r.assets]
  const media: AdMedia[] = []
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue
    for (const entry of bucket) {
      const normalized = normalizeMediaEntry(entry)
      if (normalized !== undefined) media.push(normalized)
    }
  }
  // Fall back to a single legacy media field so old-shaped feed records
  // still produce a one-item carousel.
  if (media.length === 0) {
    const single = str(r.mediaUrl) ?? str(r.video) ?? str(r.videoUrl) ?? str(r.gif) ?? str(r.image) ?? str(r.url) ?? str(r.thumbnail)
    if (single !== undefined) media.push({ kind: mediaKindOf(single), url: single })
  }
  return media
}

/** Extract a price/discount block, tolerating cents-as-integer, string, or nested `{amount, currency}` shapes. */
function normalizePrice(r: Record<string, unknown>): AdPrice | undefined {
  const priceField = r.price
  const nested = priceField !== null && typeof priceField === 'object' ? priceField as Record<string, unknown> : undefined
  const amount = num(nested?.amount) ?? num(priceField) ?? num(r.amount)
  if (amount === undefined) return undefined
  const currency = str(nested?.currency) ?? str(r.currency) ?? 'USD'
  const originalAmount = num(nested?.originalAmount) ?? num(r.originalPrice) ?? num(r.listPrice)
  const explicitDiscount = num(nested?.discountPercent) ?? num(r.discountPercent) ?? num(r.discount)
  const discountPercent = explicitDiscount
    ?? (originalAmount !== undefined && originalAmount > amount
      ? Math.round((1 - amount / originalAmount) * 100)
      : undefined)
  return { amount, currency, originalAmount, discountPercent }
}

/** Extract CTA buttons from any of several common field names/shapes. */
function normalizeCtas(r: Record<string, unknown>): AdCta[] {
  const bucket = r.ctas ?? r.buttons ?? r.actions ?? r.cta
  const list = Array.isArray(bucket) ? bucket : (bucket !== undefined ? [bucket] : [])
  const ctas: AdCta[] = []
  list.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object') return
    const e = entry as Record<string, unknown>
    const label = str(e.label) ?? str(e.text) ?? str(e.title)
    if (label === undefined) return
    const kindStr = str(e.kind) ?? str(e.type)
    const kind: AdCta['kind'] = kindStr === 'buy' || kindStr === 'cart' || kindStr === 'chat' ? kindStr : 'link'
    ctas.push({ id: str(e.id) ?? `cta-${i}`, label, kind, url: str(e.url) ?? str(e.href) })
  })
  return ctas
}

/** Extract the expandable description/specs block. */
function normalizeDetails(r: Record<string, unknown>): AdDetails | undefined {
  const description = str(r.longDescription) ?? str(r.details)
  const specsField = r.specs ?? r.attributes ?? r.specifications
  let specs: Record<string, string> | undefined
  if (specsField !== null && typeof specsField === 'object' && !Array.isArray(specsField)) {
    specs = {}
    for (const [key, value] of Object.entries(specsField as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number') specs[key] = String(value)
    }
  }
  if (description === undefined && (specs === undefined || Object.keys(specs).length === 0)) return undefined
  return { description, specs }
}

/**
 * Best-effort normalization from an arbitrary source record into an AdItem.
 * Accepts several common field-naming conventions (id/itemId, url/mediaUrl,
 * link/clickUrl, price/originalPrice, ctas/buttons/actions, media/gallery/
 * videos/images, specs/attributes, ...) so most JSON feeds — including full
 * marketplace product cards — work with zero mapping config; a caller with
 * an unusual shape can post-process `raw` itself.
 */
export function normalizeAdItem(record: unknown, index: number): AdItem | undefined {
  if (record === null || typeof record !== 'object') return undefined
  const r = record as Record<string, unknown>
  const id = str(r.id) ?? str(r.itemId) ?? str(r.sku) ?? `item-${index}`
  const media = normalizeMedia(r)
  const price = normalizePrice(r)
  const ctas = normalizeCtas(r)
  const details = normalizeDetails(r)
  const clickUrl = str(r.clickUrl) ?? str(r.link) ?? str(r.href) ?? str(r.deepLink)
  const title = str(r.title) ?? str(r.name) ?? str(r.headline)
  const body = str(r.body) ?? str(r.text) ?? str(r.description) ?? str(r.message)

  let type: AdItem['type'] = 'text'
  if (price !== undefined || ctas.length > 0 || media.length > 1 || details !== undefined) {
    type = 'product'
  } else if (media.length === 1) {
    type = media[0].kind
  } else if (body !== undefined) {
    type = 'message'
  }

  return {
    id,
    type,
    title,
    body,
    mediaUrl: media[0]?.url,
    media: media.length > 0 ? media : undefined,
    price,
    ctas: ctas.length > 0 ? ctas : undefined,
    details,
    clickUrl,
    raw: record,
  }
}

/**
 * Parse one SSE frame's `data:` payload into a text delta. Plain-string
 * payloads (including the conventional `[DONE]` sentinel, which yields
 * `undefined`) pass through as-is; JSON payloads are read via
 * `tokenPath` (falling back to a bare `text`/`delta`/`content` field).
 */
function extractSseDelta(data: string, tokenPath: string | undefined): string | undefined {
  const trimmed = data.trim()
  if (trimmed === '' || trimmed === '[DONE]') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const viaPath = tokenPath !== undefined && tokenPath !== '' ? readPath(parsed, tokenPath) : undefined
    if (typeof viaPath === 'string') return viaPath
    if (parsed !== null && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>
      const guess = p.text ?? p.delta ?? p.content ?? p.token
      return typeof guess === 'string' ? guess : undefined
    }
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    // Not JSON: treat the raw data line itself as the delta.
    return trimmed
  }
}

/**
 * Stream one endpoint call chunk-by-chunk, invoking `onChunk` with each text
 * delta as it arrives ('text' format: raw body chunks; 'sse' format: parsed
 * `data:` lines). Returns the concatenation of every delta once the stream
 * ends, for callers that also want the full reply text (e.g. to append to
 * chat history).
 * @throws on network failure, non-2xx response, a missing response body, or
 *   a request that exceeds `endpoint.timeoutMs`.
 */
export async function streamAdEndpoint(
  endpoint: AdEndpointConfig,
  creds: ResolvedAdCredentials,
  ctx: Record<string, string>,
  format: 'text' | 'sse',
  tokenPath: string | undefined,
  onChunk: (delta: string) => void,
): Promise<string> {
  const method = endpoint.method ?? 'POST'
  const url = new URL(fillTemplate(endpoint.url, ctx))
  for (const [key, value] of Object.entries(endpoint.params ?? {})) {
    url.searchParams.set(key, fillTemplate(value, ctx))
  }
  const headers: Record<string, string> = {
    accept: format === 'sse' ? 'text/event-stream' : 'text/plain, application/json',
    ...credentialHeaders(creds),
    ...(endpoint.headers ?? {}),
  }
  let body: string | undefined
  if (method !== 'GET' && endpoint.body !== undefined) {
    headers['content-type'] ??= 'application/json'
    body = JSON.stringify(fillDeep(endpoint.body, ctx))
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, endpoint.timeoutMs ?? 30_000)
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal })
    if (!res.ok) throw new Error(`ad endpoint ${url.hostname} responded ${res.status}`)
    if (res.body === null) throw new Error(`ad endpoint ${url.hostname} returned no stream body`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      if (format === 'text') {
        onChunk(buffer)
        full += buffer
        buffer = ''
        continue
      }

      // SSE: emit complete "data: ..." lines as they close out, keep any
      // trailing partial line buffered for the next chunk.
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const delta = extractSseDelta(line.slice(5), tokenPath)
        if (delta !== undefined) {
          onChunk(delta)
          full += delta
        }
      }
    }
    if (format === 'sse' && buffer.startsWith('data:')) {
      const delta = extractSseDelta(buffer.slice(5), tokenPath)
      if (delta !== undefined) {
        onChunk(delta)
        full += delta
      }
    }
    return full
  } finally {
    clearTimeout(timeout)
  }
}

/** Extract a list payload into normalized AdItems regardless of nesting shape. */
export function normalizeAdFeed(payload: unknown): AdItem[] {
  const list = Array.isArray(payload) ? payload : (payload === null || typeof payload !== 'object' ? [] : Object.values(payload as Record<string, unknown>))
  return list.map(normalizeAdItem).filter((item): item is AdItem => item !== undefined)
}
