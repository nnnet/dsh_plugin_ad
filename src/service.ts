/**
 * dsh-ad host service — owns the configured ad sources, polls their feeds on
 * an interval, and proxies chat turns to a source's AI assistant endpoint.
 * Credentials never leave the host: routes.ts hands the browser normalized
 * `AdItem`s and chat replies only.
 * @module @linxin666/dsh-ad/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AdConfig, AdSourceConfig } from './config.ts'
import { resolveCredentials } from './config.ts'
import { callAdEndpoint, normalizeAdFeed, streamAdEndpoint, type AdItem } from './adapter.ts'
import { fillTemplate } from './adapter.ts'
import { CartStore, type CartLine } from './cart.ts'

export const AD_SETTINGS_NAMESPACE = 'ad'

interface SourceCache {
  items: AdItem[]
  cursor: number
  fetchedAt: number
  lastError?: string
}

/** Public, credential-free view of a configured source for the client. */
export interface AdSourceView {
  id: string
  name: string
  enabled: boolean
  contentTypes: string[]
  hasChat: boolean
  chatStreaming: boolean
}

export class AdService extends Service {
  static readonly [Service.setup] = true

  private sources = new Map<string, AdSourceConfig>()
  private cache = new Map<string, SourceCache>()
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private cart = new CartStore()
  private enabled: boolean

  constructor(ctx: Context, private config: AdConfig) {
    super(ctx, 'ad', true)
    this.enabled = config.enabled ?? true
    for (const source of config.sources ?? []) {
      if (source.enabled === false) continue
      this.sources.set(source.id, source)
    }
    ctx.effect(() => {
      for (const source of this.sources.values()) this.startPolling(source)
      return () => { for (const timer of this.timers.values()) clearInterval(timer) }
    }, 'ad: polling')
  }

  /** Whether the plugin is currently active (settings toggle). */
  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(value: boolean): void {
    this.enabled = value
  }

  /** Credential-free list of configured sources, for the widget/settings UI. */
  listSources(): AdSourceView[] {
    return [...this.sources.values()].map((s) => ({
      id: s.id,
      name: s.name,
      enabled: s.enabled ?? true,
      contentTypes: s.contentTypes,
      hasChat: s.chat !== undefined,
      chatStreaming: s.chat?.streaming === true,
    }))
  }

  /** The source shown by default: the configured active id, or the first entry. */
  defaultSourceId(): string | undefined {
    if (this.config.activeSourceId !== undefined && this.sources.has(this.config.activeSourceId)) {
      return this.config.activeSourceId
    }
    return [...this.sources.keys()][0]
  }

  private startPolling(source: AdSourceConfig): void {
    if (source.feed === undefined) return
    const refresh = (): void => { void this.refreshFeed(source.id) }
    refresh()
    const interval = setInterval(refresh, source.pollIntervalMs ?? 60_000)
    this.timers.set(source.id, interval)
  }

  private async refreshFeed(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId)
    if (source?.feed === undefined) return
    try {
      const payload = await callAdEndpoint(source.feed, resolveCredentials(source.auth))
      const items = normalizeAdFeed(payload)
      this.cache.set(sourceId, { items, cursor: 0, fetchedAt: Date.now() })
    } catch (error) {
      const previous = this.cache.get(sourceId)
      this.cache.set(sourceId, {
        items: previous?.items ?? [],
        cursor: previous?.cursor ?? 0,
        fetchedAt: previous?.fetchedAt ?? 0,
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Force-refresh a source's feed now (e.g. from a manual "refresh" action). */
  async forceRefresh(sourceId: string): Promise<void> {
    await this.refreshFeed(sourceId)
  }

  /** Next item in the source's rotation, cycling back to the start at the end. */
  nextItem(sourceId: string): AdItem | undefined {
    const cache = this.cache.get(sourceId)
    if (cache === undefined || cache.items.length === 0) return undefined
    const item = cache.items[cache.cursor % cache.items.length]
    cache.cursor += 1
    return item
  }

  /** Resolve `{itemId}`/`{clickUrl}` placeholders in a source's click-through template. */
  resolveClickThrough(sourceId: string, item: AdItem): string | undefined {
    const source = this.sources.get(sourceId)
    if (source?.clickThroughUrl === undefined) return item.clickUrl
    return fillTemplate(source.clickThroughUrl, {
      itemId: item.id,
      clickUrl: item.clickUrl ?? '',
    })
  }

  /**
   * Send one chat turn to the source's AI-assistant endpoint and return the
   * assistant's reply text. Credentials for the chat endpoint (falling back
   * to the source's general `auth`) are attached here, server-side.
   */
  async chat(sourceId: string, message: string, history: Array<{ role: string; content: string }>): Promise<string> {
    const source = this.sources.get(sourceId)
    if (source?.chat === undefined) throw new Error(`source '${sourceId}' has no chat endpoint configured`)
    const creds = resolveCredentials(source.chat.auth ?? source.auth)
    const payload = await callAdEndpoint(source.chat.endpoint, creds, {
      message,
      history: JSON.stringify(history),
    })
    const reply = readReplyText(payload, source.chat.replyPath)
    if (reply === undefined) throw new Error(`source '${sourceId}' chat response did not contain a reply`)
    return reply
  }

  /** Whether a source is configured for live token streaming (`chat.streaming: true`). */
  supportsChatStream(sourceId: string): boolean {
    return this.sources.get(sourceId)?.chat?.streaming === true
  }

  /**
   * Stream one chat turn to the source's AI-assistant endpoint, invoking
   * `onChunk` with each token delta as it arrives. Returns the full
   * concatenated reply once the stream ends (for appending to history).
   * Credentials are resolved and attached here, server-side, exactly as in
   * the non-streaming `chat()` path.
   */
  async chatStream(
    sourceId: string,
    message: string,
    history: Array<{ role: string; content: string }>,
    onChunk: (delta: string) => void,
  ): Promise<string> {
    const source = this.sources.get(sourceId)
    if (source?.chat === undefined) throw new Error(`source '${sourceId}' has no chat endpoint configured`)
    const creds = resolveCredentials(source.chat.auth ?? source.auth)
    return streamAdEndpoint(
      source.chat.endpoint,
      creds,
      { message, history: JSON.stringify(history) },
      source.chat.streamFormat ?? 'text',
      source.chat.streamTokenPath,
      onChunk,
    )
  }

  // --- Cart -----------------------------------------------------------
  // A local mirror only (see cart.ts); it does not write back to the
  // buyer's real marketplace account. Wire a 'buy'/'cart' CTA to a
  // source-specific endpoint for that.

  cartList(sourceId: string): CartLine[] {
    return this.cart.list(sourceId)
  }

  cartTotal(sourceId: string): { amount: number; currency: string } | undefined {
    return this.cart.total(sourceId)
  }

  cartAdd(sourceId: string, itemId: string, qty = 1): CartLine[] {
    const item = this.cache.get(sourceId)?.items.find((i) => i.id === itemId)
    if (item === undefined) throw new Error(`item '${itemId}' is not in the current '${sourceId}' feed`)
    return this.cart.add(sourceId, item, qty)
  }

  cartSetQty(sourceId: string, itemId: string, qty: number): CartLine[] {
    return this.cart.setQty(sourceId, itemId, qty)
  }

  cartRemove(sourceId: string, itemId: string): CartLine[] {
    return this.cart.remove(sourceId, itemId)
  }

  cartClear(sourceId: string): CartLine[] {
    return this.cart.clear(sourceId)
  }
}

function readReplyText(payload: unknown, path: string | undefined): string | undefined {
  let cursor: unknown = payload
  if (path !== undefined && path !== '') {
    for (const segment of path.split('.')) {
      if (cursor === null || typeof cursor !== 'object') return undefined
      cursor = (cursor as Record<string, unknown>)[segment]
    }
  }
  if (typeof cursor === 'string') return cursor
  if (cursor !== null && typeof cursor === 'object' && 'text' in (cursor as Record<string, unknown>)) {
    const text = (cursor as Record<string, unknown>).text
    return typeof text === 'string' ? text : undefined
  }
  return undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ad: AdService
  }
}
