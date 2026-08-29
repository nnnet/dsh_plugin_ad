/**
 * dsh-ad host service — owns the configured ad sources, polls their feeds on
 * an interval, and proxies chat turns to a source's AI assistant endpoint.
 * Credentials never leave the host: routes.ts hands the browser normalized
 * `AdItem`s and chat replies only.
 *
 * The service also enforces each source's `frequencyCap` (in-memory rolling
 * counter) and `targeting` rules (host-supplied runtime context), so a
 * source can be configured to show only on /shop pages, only in `zh`
 * locales, etc.
 * @module dsh_plugin_ad/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AdConfig, AdSourceConfig, AdTargetingConfig } from './config.ts'
import { loadConfigFromFile, resolveCredentials } from './config.ts'
import { callAdEndpoint, normalizeAdFeed, streamAdEndpoint, type AdItem, fillTemplate } from './adapter.ts'
import { CartStore, type CartLine } from './cart.ts'
import { ERRORS } from './messages.ts'
import { CORDIS_NAME, DEFAULT_POLL_MS, MAX_HISTORY_TURNS } from './constants.ts'

export const AD_SETTINGS_NAMESPACE = CORDIS_NAME

interface SourceCache {
  items: AdItem[]
  cursor: number
  fetchedAt: number
  lastError?: string
}

interface ImpressionWindow {
  /** Timestamps (ms) of recent impressions, oldest first. */
  at: number[]
}

/** Public, credential-free view of a configured source for the client. */
export interface AdSourceView {
  id: string
  name: string
  enabled: boolean
  contentTypes: string[]
  hasChat: boolean
  chatStreaming: boolean
  /** Whether the source is currently eligible to serve creatives (frequency cap + targeting). */
  eligible: boolean
  /** Why the source is not eligible, when it isn't. */
  ineligibleReason?: 'frequency-cap' | 'targeting'
  /** Source-level campaign label (placement + priority/weight), or undefined. */
  campaignLabel?: string
  /** Names of available actions the browser can invoke. */
  actions: string[]
}

export interface AdRuntimeContext {
  locale?: string
  path?: string
  tags?: string[]
}

export class AdService extends Service {
  private sources = new Map<string, AdSourceConfig>()
  private cache = new Map<string, SourceCache>()
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private impressions = new Map<string, ImpressionWindow>()
  private cart = new CartStore()
  private enabled: boolean
  private activeSourceId: string | undefined

  constructor(ctx: Context, rawConfig: AdConfig) {
    super(ctx, CORDIS_NAME)
    const config = loadConfigFromFile(rawConfig)
    this.enabled = config.enabled ?? true
    this.activeSourceId = config.activeSourceId
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
  isEnabled(): boolean { return this.enabled }
  setEnabled(value: boolean): void { this.enabled = value }

  /** Credential-free list of configured sources, for the widget/settings UI. */
  listSources(runtime: AdRuntimeContext = {}): AdSourceView[] {
    return [...this.sources.values()].map((s) => {
      const eligibility = this.checkEligibility(s, runtime)
      const view: AdSourceView = {
        id: s.id,
        name: s.name,
        enabled: s.enabled ?? true,
        contentTypes: s.contentTypes,
        hasChat: s.chat !== undefined,
        chatStreaming: s.chat?.streaming === true,
        eligible: eligibility.eligible,
        ineligibleReason: eligibility.reason,
        actions: (s.actions ?? []).map((a) => a.id),
      }
      const label = campaignLabel(s)
      if (label !== undefined) view.campaignLabel = label
      return view
    })
  }

  /** The source shown by default: the configured active id, or the first entry. */
  defaultSourceId(): string | undefined {
    if (this.activeSourceId !== undefined && this.sources.has(this.activeSourceId)) return this.activeSourceId
    return [...this.sources.keys()][0]
  }

  private startPolling(source: AdSourceConfig): void {
    if (source.feed === undefined) return
    const refresh = (): void => { void this.refreshFeed(source.id) }
    refresh()
    const interval = setInterval(refresh, source.pollIntervalMs ?? DEFAULT_POLL_MS)
    this.timers.set(source.id, interval)
  }

  private async refreshFeed(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId)
    if (source?.feed === undefined) return
    try {
      const payload = await callAdEndpoint(
        source.feed,
        resolveCredentials(source.auth),
        {},
        source,
        source.maxResponseBytes,
      )
      const items = normalizeAdFeed(payload, source)
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
  async forceRefresh(sourceId: string): Promise<void> { await this.refreshFeed(sourceId) }

  /** Whether a source is currently eligible to serve (frequency cap + targeting). */
  isEligible(sourceId: string, runtime: AdRuntimeContext = {}): boolean {
    return this.checkEligibility(this.sources.get(sourceId), runtime).eligible
  }

  /** Record one impression for the source, enforcing its frequency cap. */
  recordImpression(sourceId: string): boolean {
    const source = this.sources.get(sourceId)
    if (source?.frequencyCap === undefined) return true
    const now = Date.now()
    const win = this.impressions.get(sourceId) ?? { at: [] }
    win.at = win.at.filter((t) => now - t < source.frequencyCap!.windowMs)
    if (win.at.length >= source.frequencyCap.maxImpressions) return false
    win.at.push(now)
    this.impressions.set(sourceId, win)
    return true
  }

  private checkEligibility(
    source: AdSourceConfig | undefined,
    runtime: AdRuntimeContext,
  ): { eligible: boolean; reason?: 'frequency-cap' | 'targeting' } {
    if (source === undefined) return { eligible: false, reason: 'targeting' }
    if (source.frequencyCap !== undefined) {
      const win = this.impressions.get(source.id)
      if (win !== undefined && win.at.length >= source.frequencyCap.maxImpressions) {
        return { eligible: false, reason: 'frequency-cap' }
      }
    }
    if (source.targeting !== undefined) {
      const target = source.targeting
      const result = matchesTargeting(target, runtime)
      if (!result) return { eligible: false, reason: 'targeting' }
    }
    return { eligible: true }
  }

  /** Next item in the source's rotation, cycling back to the start at the end. */
  nextItem(sourceId: string, runtime: AdRuntimeContext = {}): AdItem | undefined {
    const cache = this.cache.get(sourceId)
    if (cache === undefined || cache.items.length === 0) return undefined
    if (!this.isEligible(sourceId, runtime)) return undefined
    const item = cache.items[cache.cursor % cache.items.length]
    cache.cursor += 1
    this.recordImpression(sourceId)
    return item
  }

  /** Resolve `{itemId}`/`{clickUrl}` placeholders in a source's click-through template. */
  resolveClickThrough(sourceId: string, item: AdItem): string | undefined {
    const source = this.sources.get(sourceId)
    if (source?.clickThroughUrl === undefined) return item.clickUrl
    return fillTemplate(source.clickThroughUrl, {
      itemId: encodeURIComponent(item.id),
      clickUrl: item.clickUrl ?? '',
    })
  }

  /**
   * Send one chat turn to the source's AI-assistant endpoint and return the
   * assistant's reply text. Credentials for the chat endpoint (falling back
   * to the source's general `auth`) are attached here, server-side.
   */
  async chat(
    sourceId: string,
    message: string,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const source = this.sources.get(sourceId)
    if (source?.chat === undefined) throw new Error(ERRORS.sourceMissingChat(sourceId))
    const creds = resolveCredentials(source.chat.auth ?? source.auth)
    const payload = await callAdEndpoint(
      source.chat.endpoint,
      creds,
      { message, history: JSON.stringify(history) },
      source,
      source.maxResponseBytes,
    )
    const reply = readReplyText(payload, source.chat.replyPath)
    if (reply === undefined) throw new Error(ERRORS.chatResponseMissingReply(sourceId))
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
    if (source?.chat === undefined) throw new Error(ERRORS.sourceMissingChat(sourceId))
    if (source.chat.streaming !== true) throw new Error(ERRORS.chatStreamingUnavailable(sourceId))
    const creds = resolveCredentials(source.chat.auth ?? source.auth)
    return streamAdEndpoint(
      source.chat.endpoint,
      creds,
      { message, history: JSON.stringify(history) },
      source.chat.streamFormat ?? 'text',
      source.chat.streamTokenPath,
      onChunk,
      source,
      source.maxResponseBytes,
    )
  }

  // --- Tracking & actions ---------------------------------------------

  /** Record an analytics event for the source. The host may forward to the source's tracking endpoints. */
  async track(
    sourceId: string,
    event: 'impression' | 'click' | 'conversion',
    payload: Record<string, unknown> = {},
  ): Promise<{ ok: true; forwarded: boolean }> {
    const source = this.sources.get(sourceId)
    if (source === undefined) throw new Error(ERRORS.sourceIdUnknown(sourceId))
    if (source.tracking === undefined) return { ok: true, forwarded: false }
    const url = event === 'impression' ? source.tracking.impressionUrl
      : event === 'click' ? source.tracking.clickUrl
      : source.tracking.conversionUrl
    if (url === undefined) return { ok: true, forwarded: false }
    try {
      const creds = resolveCredentials(source.auth)
      await callAdEndpoint(
        { url, method: 'POST', body: { sourceId, event, payload } },
        creds,
        { sourceId, event: event, payload: JSON.stringify(payload) },
        source,
        source.maxResponseBytes,
      )
      return { ok: true, forwarded: true }
    } catch {
      return { ok: true, forwarded: false }
    }
  }

  /** Invoke a source-defined action by id (e.g. "details", "addToCart", "checkout"). */
  async action(
    sourceId: string,
    actionId: string,
    payload: Record<string, unknown> = {},
  ): Promise<unknown> {
    const source = this.sources.get(sourceId)
    if (source === undefined) throw new Error(ERRORS.sourceIdUnknown(sourceId))
    const action = (source.actions ?? []).find((a) => a.id === actionId)
    if (action === undefined) throw new Error(`unknown action '${actionId}' on source '${sourceId}'`)
    const creds = resolveCredentials(action.auth ?? source.auth)
    return callAdEndpoint(
      action.endpoint,
      creds,
      { ...payload, sourceId, actionId } as unknown as Record<string, string>,
      source,
      source.maxResponseBytes,
    )
  }

  // --- Cart (local mirror; see cart.ts) -----------------------------------
  cartList(sourceId: string): CartLine[] { return this.cart.list(sourceId) }
  cartTotal(sourceId: string): { amount: number; currency: string } | undefined { return this.cart.total(sourceId) }
  cartAdd(sourceId: string, itemId: string, qty = 1): CartLine[] {
    const item = this.cache.get(sourceId)?.items.find((i) => i.id === itemId)
    if (item === undefined) throw new Error(ERRORS.itemNotInFeed(itemId, sourceId))
    return this.cart.add(sourceId, item, qty)
  }
  cartSetQty(sourceId: string, itemId: string, qty: number): CartLine[] { return this.cart.setQty(sourceId, itemId, qty) }
  cartRemove(sourceId: string, itemId: string): CartLine[] { return this.cart.remove(sourceId, itemId) }
  cartClear(sourceId: string): CartLine[] { return this.cart.clear(sourceId) }
}

function campaignLabel(source: AdSourceConfig): string | undefined {
  if (source.campaign === undefined) return undefined
  const placement = source.campaign.placement ?? source.campaign.id
  if (placement === undefined) return undefined
  const tail: string[] = []
  if (source.campaign.priority !== undefined) tail.push(`p${source.campaign.priority}`)
  if (source.campaign.weight !== undefined) tail.push(`w${source.campaign.weight}`)
  return tail.length === 0 ? placement : `${placement} (${tail.join('/')})`
}

function matchesTargeting(target: AdTargetingConfig, runtime: AdRuntimeContext): boolean {
  if (target.locales !== undefined && target.locales.length > 0) {
    if (runtime.locale === undefined || !target.locales.includes(runtime.locale)) return false
  }
  if (target.paths !== undefined && target.paths.length > 0) {
    if (runtime.path === undefined || !target.paths.some((p) => runtime.path === p || runtime.path?.startsWith(p))) return false
  }
  if (target.excludePaths !== undefined && target.excludePaths.length > 0) {
    if (runtime.path !== undefined && target.excludePaths.some((p) => runtime.path === p || runtime.path?.startsWith(p))) return false
  }
  if (target.tags !== undefined && target.tags.length > 0) {
    const tags = runtime.tags ?? []
    if (!target.tags.some((t) => tags.includes(t))) return false
  }
  if (target.excludeTags !== undefined && target.excludeTags.length > 0) {
    const tags = runtime.tags ?? []
    if (target.excludeTags.some((t) => tags.includes(t))) return false
  }
  return true
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

/** Trim a history array to the last `MAX_HISTORY_TURNS` entries (defensive). */
export function trimHistory(
  history: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  return history.length > MAX_HISTORY_TURNS ? history.slice(-MAX_HISTORY_TURNS) : history
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ad: AdService
  }
}
