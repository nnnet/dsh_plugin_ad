/**
 * Generic HTTP adapter for ad sources: substitutes `{placeholders}`, attaches
 * resolved credentials, enforces the source's `allowHosts` and size caps,
 * performs the request, and extracts the configured response path. Kept
 * source-agnostic on purpose — a CS:GO marketplace, a banner CDN, and a
 * bespoke ad server all speak through the same shape (see config.ts).
 * @module dsh_plugin_ad/adapter
 */

import type { AdEndpointConfig, AdSourceConfig, ResolvedAdCredentials } from './config.ts'
import { getPath as readDotPath } from './mapping.ts'
import { ERRORS } from './messages.ts'
import { DEFAULT_CHAT_TIMEOUT_MS, DEFAULT_MAX_ITEMS, DEFAULT_REQUEST_TIMEOUT_MS, MAX_FEED_ITEMS, STREAM_MAX_BYTES } from './constants.ts'

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
  type: 'video' | 'gif' | 'image' | 'text' | 'message' | 'product' | 'html' | 'card' | 'raw'
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
  return readDotPath(payload, path)
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')) return true
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true
  if (/^169\.254\./.test(h)) return true
  return false
}

/** Enforce a source's `allowHosts` / `allowPrivateNetwork` controls. */
export function ensureAllowedUrl(raw: string, source: AdSourceConfig): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(ERRORS.urlProtocol(url.protocol))
  }
  const allowHosts = source.allowHosts ?? []
  const host = url.hostname.toLowerCase()
  const allowed = allowHosts.length === 0
    ? true
    : allowHosts.some((h) => host === h.toLowerCase() || host.endsWith('.' + h.toLowerCase()))
  if (!allowed) throw new Error(ERRORS.hostNotAllowed(host))
  if (!source.allowPrivateNetwork && isPrivateHostname(host)) {
    throw new Error(ERRORS.privateNetworkDisabled(host))
  }
  return url
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
 * Read the full response body into a Uint8Array while enforcing a hard size
 * cap. The cap is checked against the Content-Length header when present
 * and against the running total while reading; overshoots throw
 * `responseTooLarge` and the request is destroyed.
 */
async function readBoundedResponse(res: Response, cap: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > 0 && declared > cap) {
    await res.body?.cancel()
    throw new Error(ERRORS.responseTooLarge(cap))
  }
  if (res.body === null) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue
    size += value.byteLength
    if (size > cap) {
      try { await reader.cancel() } catch { /* noop */ }
      throw new Error(ERRORS.responseTooLarge(cap))
    }
    chunks.push(value)
  }
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}

/**
 * Perform one endpoint call, applying credentials, template substitution,
 * allowlist checks, and the configured `responsePath` extraction.
 * @throws on URL not allowed, network failure, non-2xx response, an
 *   oversize body, or a request that exceeds `endpoint.timeoutMs`.
 */
export async function callAdEndpoint(
  endpoint: AdEndpointConfig,
  creds: ResolvedAdCredentials,
  ctx: Record<string, string> = {},
  source: AdSourceConfig = { id: '', name: '', contentTypes: [] } as AdSourceConfig,
  cap: number = STREAM_MAX_BYTES,
): Promise<unknown> {
  const method = endpoint.method ?? 'GET'
  const rawUrl = fillTemplate(endpoint.url, ctx)
  const url = ensureAllowedUrl(rawUrl, source)
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
  const timeoutMs = endpoint.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal })
    if (!res.ok) throw new Error(ERRORS.endpointNon2xx(url.hostname, res.status))
    const bytes = await readBoundedResponse(res, cap)
    if (bytes.byteLength === 0) return undefined
    const payload: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'))
    return readPath(payload, endpoint.responsePath)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(ERRORS.endpointTimeout(timeoutMs))
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function mediaKindOf(url: string): AdMedia['kind'] {
  if (/\.mp4($|\?)/i.test(url)) return 'video'
  if (/\.webm($|\?)/i.test(url)) return 'video'
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
 * an unusual shape can post-process `raw` itself, or supply a `mapping`
 * override on the source.
 *
 * Special mapping sentinels:
 *   - `id: "__HASH_NAME__"` — use the entry's own top-level key (CS:GO
 *     market's flat `{ "<hash_name>": <price> }` feed uses this).
 *   - `priceAmount: "__PRICE__"` — use the entry's own value (same).
 *   - `imageBaseUrl: "__BASE__"` — synthesize a per-item image URL from
 *     the hash_name via the source's `extra.__csgoImageWidth`.
 */
export function normalizeAdItem(record: unknown, index: number, source?: AdSourceConfig): AdItem | undefined {
  if (record === null || typeof record !== 'object') return undefined
  const r = record as Record<string, unknown>
  const m = source?.mapping

  // Detect the flat-map shape used by CS:GO/Dota markets: the record
  // has a single key whose value is the price. `normalizeAdFeed` rebuilds
  // the record as `{ [hashName]: price }` for each entry, so the entry we
  // receive here always has exactly one key.
  const flatHashName = (() => {
    if (m?.id !== '__HASH_NAME__') return undefined
    const keys = Object.keys(r)
    return keys.length === 1 ? keys[0] : undefined
  })()
  const flatPrice = (() => {
    if (m?.priceAmount !== '__PRICE__') return undefined
    if (flatHashName !== undefined) return r[flatHashName]
    return undefined
  })()

  const id = flatHashName
    ?? (m?.id !== undefined && m.id !== '__HASH_NAME__' ? str(readPath(r, m.id)) : undefined)
    ?? str(r.id) ?? str(r.itemId) ?? str(r.sku) ?? `item-${index}`

  // Mapping overrides take precedence when present.
  const titleFromMapping = m?.title !== undefined && m.title !== '__HASH_NAME__'
    ? str(readPath(r, m.title)) : (flatHashName ?? undefined)
  const bodyFromMapping = m?.body !== undefined ? str(readPath(r, m.body)) : undefined
  const mediaFromMapping = m?.mediaUrl !== undefined ? str(readPath(r, m.mediaUrl)) : undefined
  const clickFromMapping = m?.clickUrl !== undefined ? str(readPath(r, m.clickUrl)) : undefined
  const priceFromMapping = flatPrice !== undefined
    ? (typeof flatPrice === 'string' && flatPrice.trim() !== '' && Number.isFinite(Number(flatPrice))
      ? Number(flatPrice)
      : num(flatPrice))
    : (m?.priceAmount !== undefined && m.priceAmount !== '__PRICE__' ? num(readPath(r, m.priceAmount)) : undefined)
  const currencyFromMapping = m?.priceCurrency !== undefined ? str(readPath(r, m.priceCurrency)) : undefined
  const originalFromMapping = m?.originalPrice !== undefined ? num(readPath(r, m.originalPrice)) : undefined

  const media = normalizeMedia(m?.mediaUrl !== undefined && mediaFromMapping === undefined
    ? { mediaUrl: undefined }
    : r)
  if (mediaFromMapping !== undefined && !media.some((x) => x.url === mediaFromMapping)) {
    media.unshift({ kind: mediaKindOf(mediaFromMapping), url: mediaFromMapping })
  }
  // Synthesize a per-item image when the source asks for `__BASE__`
  // (the CS:GO preset does this so the renderer can show the
  // cdn2.csgo.com webp without a separate field on the feed record).
  if (m?.imageBaseUrl === '__BASE__' && flatHashName !== undefined) {
    const width = num(source?.extra?.['__csgoImageWidth']) ?? 458
    const synth = `https://cdn2.csgo.com/item/image/width=${width}/${encodeURIComponent(flatHashName)}.webp`
    if (!media.some((x) => x.url === synth)) {
      media.unshift({ kind: 'image', url: synth })
    }
  }
  // Image base URL — if the feed returns relative image paths, prefix them.
  const baseUrl = m?.imageBaseUrl !== undefined && m.imageBaseUrl !== '__BASE__' ? str(readPath(r, m.imageBaseUrl)) : undefined
  if (baseUrl !== undefined) {
    for (const entry of media) {
      try { new URL(entry.url) } catch { entry.url = new URL(entry.url, baseUrl).toString() }
    }
  }

  const price = priceFromMapping !== undefined
    ? {
        amount: priceFromMapping,
        currency: currencyFromMapping
          ?? (source?.extra !== undefined ? str(source.extra['__csgoCurrency']) : undefined)
          ?? 'USD',
        originalAmount: originalFromMapping,
        discountPercent: originalFromMapping !== undefined && originalFromMapping > priceFromMapping
          ? Math.round((1 - priceFromMapping / originalFromMapping) * 100)
          : undefined,
      }
    : normalizePrice(r)

  const ctas = normalizeCtas(r)
  const details = normalizeDetails(r)
  const clickUrl = clickFromMapping ?? str(r.clickUrl) ?? str(r.link) ?? str(r.href) ?? str(r.deepLink)
  const title = titleFromMapping ?? str(r.title) ?? str(r.name) ?? str(r.headline)
  const body = bodyFromMapping ?? str(r.body) ?? str(r.text) ?? str(r.description) ?? str(r.message)

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
 * chat history). A size cap is enforced on the total buffered response.
 */
export async function streamAdEndpoint(
  endpoint: AdEndpointConfig,
  creds: ResolvedAdCredentials,
  ctx: Record<string, string>,
  format: 'text' | 'sse',
  tokenPath: string | undefined,
  onChunk: (delta: string) => void,
  source: AdSourceConfig = { id: '', name: '', contentTypes: [] } as AdSourceConfig,
  cap: number = STREAM_MAX_BYTES,
): Promise<string> {
  const method = endpoint.method ?? 'POST'
  const rawUrl = fillTemplate(endpoint.url, ctx)
  const url = ensureAllowedUrl(rawUrl, source)
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
  const timeoutMs = endpoint.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal })
    if (!res.ok) throw new Error(ERRORS.endpointNon2xx(url.hostname, res.status))
    if (res.body === null) throw new Error(ERRORS.endpointNoStreamBody(url.hostname))

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > cap) {
        try { await reader.cancel() } catch { /* noop */ }
        throw new Error(ERRORS.responseTooLarge(cap))
      }
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
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(ERRORS.endpointTimeout(timeoutMs))
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Per-source item cap (with the global `MAX_FEED_ITEMS` ceiling as a safety net). */
function effectiveMaxItems(source?: AdSourceConfig): number {
  const perSource = source?.maxItems ?? DEFAULT_MAX_ITEMS
  return Math.max(1, Math.min(perSource, MAX_FEED_ITEMS))
}

/** Extract a list payload into normalized AdItems regardless of nesting shape. */
export function normalizeAdFeed(payload: unknown, source?: AdSourceConfig): AdItem[] {
  const cap = effectiveMaxItems(source)
  if (Array.isArray(payload)) {
    return payload.map((entry, i) => normalizeAdItem(entry, i, source))
      .filter((item): item is AdItem => item !== undefined).slice(0, cap)
  }
  if (payload === null || typeof payload !== 'object') return []
  // Detect the flat-map shape used by CS:GO/Dota markets: the source
  // declares `id: "__HASH_NAME__"` and `priceAmount: "__PRICE__"`. In
  // that case rebuild each entry as `{ hash_name, price }` so the
  // normalizer's sentinels can find them. CS:GO feed is
  // `{ success, time, currency, items: [{ market_hash_name, volume, price }, ...] }`
  // — for the items array we unwrap one level, then the *value* is the
  // string `market_hash_name` itself (CS:GO flat shape), not the price.
  if (source?.mapping?.id === '__HASH_NAME__' && source?.mapping?.priceAmount === '__PRICE__') {
    const root = payload as Record<string, unknown>
    let items: Array<[string, unknown]> = []
    const rawItems = root['items']
    if (Array.isArray(rawItems)) {
      for (const entry of rawItems) {
        if (entry !== null && typeof entry === 'object') {
          const obj = entry as Record<string, unknown>
          const hash = obj['market_hash_name'] ?? obj['hash_name']
          const price = obj['price']
          if (typeof hash === 'string' && price !== undefined) {
            items.push([hash, price])
          }
        }
      }
    } else {
      // Fallback: assume the whole object is a flat map of {hash_name: price}.
      // CS:GO market returns price as a number-string like "1139.50"; coerce
      // to number and keep only entries that look like a price (finite,
      // positive). Drops metadata keys like `success: true` or
      // `currency: "RUB"`.
      items = Object.entries(root)
        .map(([k, v]) => {
          const n = typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v
          return n !== undefined ? [k, n] as [string, unknown] : null
        })
        .filter((entry): entry is [string, unknown] => entry !== null && typeof entry[1] === 'number' && Number.isFinite(entry[1] as number) && (entry[1] as number) > 0)
    }
    const entries = items.map(([hashName, price]) => ({ [hashName]: price }))
    return entries.map((entry, i) => normalizeAdItem(entry, i, source))
      .filter((item): item is AdItem => item !== undefined).slice(0, cap)
  }
  const list = Object.values(payload as Record<string, unknown>)
  return list.map((entry, i) => normalizeAdItem(entry, i, source))
    .filter((item): item is AdItem => item !== undefined).slice(0, cap)
}
