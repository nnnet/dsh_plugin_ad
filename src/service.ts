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
import {
  CORDIS_NAME,
  DEFAULT_MAX_ITEMS,
  DEFAULT_POLL_MS,
  DEFAULT_WIDGET_INSET,
  DEFAULT_WIDGET_SIZE,
  MAX_FEED_ITEMS,
  MAX_HISTORY_TURNS,
  MAX_WIDGET_INSET,
  MAX_WIDGET_SIZE,
  MIN_WIDGET_INSET,
  MIN_WIDGET_SIZE,
} from './constants.ts'

/** Pet-style widget display settings: a single struct shared with the host
 * settings document and the `/api/ad/display` mutation route. */
export interface AdDisplaySettings {
  visible: boolean
  enabled: boolean
  decorationEnabled: boolean
  size: number
  right: number
  bottom: number
  /** Auto-rotation interval in milliseconds. Drives the widget's
   *  `setInterval` on `/api/ad/next`. `undefined` means "use the
   *  client-side default" (WIDGET_ROTATION_MS, currently 15 s). */
  rotationMs?: number
}

const DEFAULT_DISPLAY: AdDisplaySettings = {
  visible: true,
  enabled: true,
  decorationEnabled: true,
  size: DEFAULT_WIDGET_SIZE,
  right: DEFAULT_WIDGET_INSET,
  bottom: 20,
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

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
  /** How many items the host currently has in rotation for this source. */
  itemCount: number
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
  /**
   * Pet-style display settings, mirrored from the host settings document.
   * The host's `installSettingsSection` is the source of truth — this
   * struct exists so the runtime can answer `/api/ad/sources` and
   * `/api/ad/display` without a round-trip through the settings store.
   */
  private display: AdDisplaySettings = { ...DEFAULT_DISPLAY }

  /**
   * Active item counts per source — surfaces in the widget header as
   * «N товаров в ротации» so the user can see how much the source has
   * actually loaded (the old "только несколько скинов" was a 50-item cap
   * the user couldn't see).
   */
  private readonly itemCounts = new Map<string, number>()

  constructor(ctx: Context, rawConfig: AdConfig) {
    super(ctx, CORDIS_NAME)
    const config = loadConfigFromFile(rawConfig)
    this.enabled = config.enabled ?? true
    this.activeSourceId = config.activeSourceId
    if (config.widget !== undefined) {
      // Seed display from config so the widget picks up the user's
      // configured size/position without waiting for the first settings
      // round-trip. The settings card is still the source of truth once
      // the user opens it.
      const w = config.widget
      this.setDisplay({
        visible: w.visible ?? true,
        enabled: w.enabled ?? true,
        decorationEnabled: w.decorationEnabled ?? true,
        size: w.size ?? DEFAULT_WIDGET_SIZE,
        right: w.right ?? DEFAULT_WIDGET_INSET,
        bottom: w.bottom ?? 20,
      })
    }
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

  /**
   * The currently-active source id (the one the widget rotates through).
   * Defaults to the configured `activeSourceId` or the first registered
   * source. Live-editable from the settings card so the user can pick
   * which source is on by default without restarting the plugin.
   */
  activeId(): string | undefined { return this.activeSourceId }
  setActiveSourceId(value: string): void {
    if (this.sources.has(value)) this.activeSourceId = value
  }

  /** Read the current display settings (Pet-style). */
  getDisplay(): AdDisplaySettings {
    return { ...this.display }
  }

  /**
   * Apply a display patch (called from the host settings onChange hook
   * and from the `/api/ad/display` route after a drag). Unknown fields
   * are silently dropped; numeric fields are clamped where the bounds
   * make sense.
   *
   * `right` / `bottom` are deliberately NOT clamped here. The settings
   * schema does expose a 0..MAX_WIDGET_INSET (200 px) range for
   * user-edited inset values in `config.ts`, but the *drag* position
   * is bounded by the *viewport* (see AdWidget.onPointerMoveWidget)
   * and the user's window can be any size — a 4K monitor is wider
   * than 200 px. Clamping drag values to 200 here would cap the widget
   * to a 200×200 area in the bottom-right corner regardless of
   * viewport, which is the "limited space" bug. We accept any finite
   * non-negative integer and let the client enforce the viewport
   * bound on every move.
   */
  setDisplay(patch: Partial<AdDisplaySettings>): void {
    const next: AdDisplaySettings = { ...this.display, ...patch }
    next.size = clampInt(next.size, MIN_WIDGET_SIZE, MAX_WIDGET_SIZE, DEFAULT_WIDGET_SIZE)
    if (typeof next.right === 'number' && Number.isFinite(next.right) && next.right >= 0) {
      next.right = Math.round(next.right)
    } else {
      next.right = DEFAULT_WIDGET_INSET
    }
    if (typeof next.bottom === 'number' && Number.isFinite(next.bottom) && next.bottom >= 0) {
      next.bottom = Math.round(next.bottom)
    } else {
      next.bottom = 20
    }
    // rotationMs: integer milliseconds, 1s..10min. Anything outside
    // the band is dropped (undefined) so a malformed client doesn't
    // freeze the widget on a 0-ms or year-long interval.
    if (patch.rotationMs !== undefined) {
      const v = patch.rotationMs
      if (Number.isInteger(v) && v >= 1_000 && v <= 600_000) {
        next.rotationMs = v
      } else {
        delete next.rotationMs
      }
    }
    this.display = next
  }

  /**
   * Read the count of items currently in rotation for a source (after
   * `maxItems` and global cap). Returns 0 for unknown sources. Used by
   * the widget header to show «N товаров».
   */
  getItemCount(sourceId: string): number {
    return this.itemCounts.get(sourceId) ?? 0
  }

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
        itemCount: this.itemCounts.get(s.id) ?? 0,
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
    // Static-list sources (no `feed`) get a one-shot load — no interval.
    if (source.feed === undefined) {
      if ((source.staticItems ?? []).length > 0) {
        this.seedStaticItems(source)
      }
      return
    }
    const refresh = (): void => { void this.refreshFeed(source.id) }
    refresh()
    const interval = setInterval(refresh, source.pollIntervalMs ?? DEFAULT_POLL_MS)
    this.timers.set(source.id, interval)
  }

  /**
   * Seed the cache with the source's `staticItems` (one-shot, no polling).
   * Honours `maxItems` and the global `MAX_FEED_ITEMS` ceiling.
   */
  private seedStaticItems(source: AdSourceConfig): void {
    const raw = source.staticItems ?? []
    const cap = source.maxItems ?? DEFAULT_MAX_ITEMS
    const items = raw.slice(0, Math.min(cap, MAX_FEED_ITEMS))
    // Cursor starts at n-1 so the first +1 call shows items[0],
    // preserving the original v0.6 rotation order (A, B, C, A, …).
    // A -1 call from this state shows the last item, which matches
    // user expectation ("there's nothing before the first").
    const cursor = items.length > 0 ? items.length - 1 : 0
    this.cache.set(source.id, { items, cursor, fetchedAt: Date.now() })
    this.itemCounts.set(source.id, items.length)
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
      // Same convention as seedStaticItems: start at n-1 so the
      // first +1 call shows items[0].
      const cursor = items.length > 0 ? items.length - 1 : 0
      this.cache.set(sourceId, { items, cursor, fetchedAt: Date.now() })
      this.itemCounts.set(sourceId, items.length)
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

  /**
   * Read the full source config for the given id, or `undefined` if
   * the source is not registered. Used by the `/api/ad/next` route
   * to resolve per-source display timing (`displayMs` /
   * `minVideoMs` / `maxVideoMs`) without round-tripping through
   * `listSources` (which is intentionally credential-free and
   * stripped-down).
   */
  getSource(sourceId: string): AdSourceConfig | undefined {
    return this.sources.get(sourceId)
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

  /**
   * Return the next item in the source's rotation, cycling back to the
   * start at the end. `delta` is the direction: `+1` advances
   * forward, `-1` goes back, `0` returns the current item. Used
   * by the widget's auto-rotation (delta=+1) and by the manual
   * prev/next nav buttons (delta=±1).
   *
   * The cursor convention is "index of the last shown item". The
   * cursor starts at `(n - 1) mod n` so the very first +1 call
   * shows items[0] (preserving the original v0.6 rotation order:
   * A, B, C, A, B, C). After a `delta` step:
   *   readAt = (cursor + delta + n) % n
   *   cursor = readAt
   *
   * Examples (items=['A','B','C'], starting cursor=2):
   *   delta=+1 → shows 'A' (0, wrap), cursor=0
   *   delta=+1 → shows 'B' (1), cursor=1
   *   delta=+1 → shows 'C' (2), cursor=2
   *   delta=-1 (from cursor=2) → shows 'B' (1), cursor=1
   *   delta=-1 (from cursor=0) → shows 'C' (2, wrap), cursor=2
   */
  nextItem(sourceId: string, runtime: AdRuntimeContext = {}, delta: number = 1): AdItem | undefined {
    const cache = this.cache.get(sourceId)
    if (cache === undefined || cache.items.length === 0) return undefined
    if (!this.isEligible(sourceId, runtime)) return undefined
    const n = cache.items.length
    const readAt = ((cache.cursor + delta) % n + n) % n
    const item = cache.items[readAt]
    cache.cursor = readAt
    this.recordImpression(sourceId)
    return item
  }

  /**
   * Resolve the URL the widget opens on click.
   *
   * Priority: per-item `item.clickUrl` first (e.g. a tyan.ai
   * per-character messenger page or a marketplace item link produced
   * by `normalizeMarketplaceItem`), then the source-level
   * `clickThroughUrl` template (with `{itemId}` / `{clickUrl}`
   * substitution for sources whose items don't carry their own
   * destination URL).
   */
  resolveClickThrough(sourceId: string, item: AdItem): string | undefined {
    if (item.clickUrl !== undefined && item.clickUrl !== '') return item.clickUrl
    const source = this.sources.get(sourceId)
    if (source?.clickThroughUrl === undefined) return undefined
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
