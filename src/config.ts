/**
 * dsh-ad config surface — describes one or more *ad sources* the plugin can
 * pull content from and click through to. A source is deliberately generic:
 * it can be a static creative feed (mp4/gif/image/text), a message-style
 * feed (e.g. a marketplace's "today's picks" list), a full marketplace
 * product card carousel, or a live chat endpoint backed by an AI shopping
 * assistant. Every network shape (URL, method, headers, body, response
 * field to read, host allowlist, size cap) is configurable so one plugin
 * install can point at very different backends — a CS:GO skin marketplace,
 * a banner CDN, an internal ad server — without a code change.
 *
 * The same `AdSourceConfig` shape is consumed by both:
 *   - the host (host/service.ts) for polling feeds and proxying chat, and
 *   - the client (client/AdWidget.tsx) for choosing what to render.
 *
 * Secrets: every credential field has a matching `<field>Env` sibling.
 * Set the `*Env` variant to read the secret from `process.env` at request
 * time instead of inlining it in the config file. Prefer the env-var form
 * for anything checked into source control; the plain fields exist for
 * local experimentation and quick setups where the risk is accepted.
 * @module dsh_plugin_ad/config
 */

import z from 'schemastery'
import { readFileSync, existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import yaml from 'js-yaml'
import { ALL_CONTENT_TYPES, DEFAULT_CONTENT_TYPES, DEFAULT_POLL_MS, MAX_POLL_MS, MIN_POLL_MS } from './constants.ts'

/** Content shapes an ad source can hand back. A source may support several. */
export type AdContentType = (typeof ALL_CONTENT_TYPES)[number]

/** All known content types (mirrors `AdContentType`; one source of truth in constants.ts). */
export const AD_CONTENT_TYPES = ALL_CONTENT_TYPES

/**
 * Credential bundle for a source's buyer / account cabinet. Every secret
 * field has a matching `<field>Env` sibling: set the `*Env` variant to read
 * the secret from `process.env` at request time instead of inlining it in
 * the config file. Prefer the env-var form for anything checked into source
 * control or shared between deployments.
 */
export interface AdCredentials {
  login?: string
  loginEnv?: string
  password?: string
  passwordEnv?: string
  apiKey?: string
  apiKeyEnv?: string
  token?: string
  tokenEnv?: string
  /** Anything a bespoke backend needs beyond login/password/apiKey/token. */
  extra?: Record<string, string>
}

/**
 * One HTTP call description: enough to hit a REST feed, a GraphQL endpoint
 * used as POST+body, or a vendor SDK's plain JSON gateway. `{placeholders}`
 * inside `url`, `params`, and `body` (string leaves only) are substituted
 * from the call's runtime context (e.g. `{cursor}`, `{query}`, `{itemId}`)
 * before the request is sent.
 */
export interface AdEndpointConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT'
  headers?: Record<string, string>
  params?: Record<string, string>
  /** Sent as the JSON body for POST/PUT; ignored for GET. */
  body?: unknown
  /**
   * Dot path into the parsed JSON response where the payload lives, e.g.
   * `'data.items'` for `{ data: { items: [...] } }`. Empty/omitted reads the
   * whole response body as the payload.
   */
  responsePath?: string
  /** Request timeout in ms. Default 8000 (chat uses 30000). */
  timeoutMs?: number
}

/**
 * Impression-frequency cap: how many times the widget will show creatives
 * from this source within a rolling window. Tracked per-host, not per-user
 * (a local in-memory counter; resets on host restart).
 */
export interface AdFrequencyCap {
  /** Max impressions in the window. */
  maxImpressions: number
  /** Window length in ms. */
  windowMs: number
}

/**
 * One named action a source exposes to the browser. The widget invokes
 * actions by id via `/api/ad/action`; the host calls the configured
 * endpoint server-side (attaching credentials) and returns the result
 * verbatim. Used for marketplace "details", "addToCart", "checkout",
 * vendor-specific "track" calls, etc.
 */
export interface AdActionConfig {
  /** Stable id the browser uses to invoke this action. */
  id: string
  /** Display label (locale-aware, optional). */
  label?: string
  /** Optional icon name, free-form for the widget to interpret. */
  icon?: string
  /** HTTP call description. Same shape as `feed.endpoint`. */
  endpoint: AdEndpointConfig
  /** Credentials for this action. Falls back to the source's `auth`. */
  auth?: AdCredentials
  /**
   * When true, the action is allowed to be invoked without an explicit
   * user click (e.g. impression beacons). When false, the widget must
   * gate the call behind a real user gesture.
   */
  autoInvoke?: boolean
}

/**
 * Privacy-conscious targeting hints. Values must be explicitly supplied by
 * the host/source — the plugin never inspects URL or browser state on its
 * own. A source is considered eligible when every present `must*` set has
 * at least one match and the `exclude*` sets have no matches.
 */
export interface AdTargetingConfig {
  locales?: string[]
  paths?: string[]
  excludePaths?: string[]
  tags?: string[]
  excludeTags?: string[]
}

/**
 * One configured ad source — a marketplace, a creative CDN, an internal ad
 * server, anything that can hand back cards, clips, or chat replies. All of
 * `feed` / `chat` / `extra` are optional so the same shape covers a
 * pure-static asset rotation as well as a fully interactive AI shopping
 * assistant.
 */
export interface AdSourceConfig {
  /** Stable id used in routes and logs, e.g. 'acme-marketplace'. */
  id: string
  /** Display name shown in the widget / settings UI. */
  name: string
  enabled?: boolean
  /** Which content shapes this source is expected to return. */
  contentTypes: AdContentType[]
  /**
   * How to pull the rotating feed of creatives/cards. Omit for a
   * chat-only source.
   */
  feed?: AdEndpointConfig
  /**
   * Click-through URL template opened when the user activates a card. May
   * reference `{itemId}`, `{clickUrl}`, or any field present on the ad item
   * returned by `feed`.
   */
  clickThroughUrl?: string
  /**
   * AI shopping/assistant chat integration. When present the widget offers
   * a chat surface backed by this endpoint; credentials in `auth` (or
   * `chat.auth` to use a separate identity for chat vs feed) are attached
   * server-side and never sent to the browser.
   */
  chat?: {
    endpoint: AdEndpointConfig
    auth?: AdCredentials
    /** Dot path to the assistant's reply text in the response JSON (non-streaming mode). */
    replyPath?: string
    /**
     * When true, `/api/ad/chat/stream` proxies the endpoint as a live token
     * stream instead of waiting for the full JSON reply. Added in v0.2;
     * omitting it (or leaving it false) reproduces the exact v0.1 behavior,
     * so existing configs need no changes to keep working.
     */
    streaming?: boolean
    /**
     * Shape of the streamed response: 'text' (default) treats each chunk
     * of the HTTP response body as a raw text delta; 'sse' parses
     * `data: {...}` / `data: <text>` lines and, for JSON payloads, reads
     * `streamTokenPath` out of each one.
     */
    streamFormat?: 'text' | 'sse'
    /** Dot path to the delta text inside each SSE JSON payload. Ignored for 'text' format or plain-string SSE data. */
    streamTokenPath?: string
  }
  /** Buyer/account-cabinet credentials used for the feed endpoint. */
  auth?: AdCredentials
  /** How often to refresh the feed, in ms. Default 60000. */
  pollIntervalMs?: number
  /**
   * Fully open passthrough bag for anything source-specific that doesn't
   * fit the modeled fields above (vendor flags, experiment ids, region
   * codes, ...). Forwarded verbatim to custom source adapters.
   */
  extra?: Record<string, unknown>

  // --- v0.3 additions: security & advanced controls --------------------

  /**
   * Host allowlist for this source's outbound requests. If set, every URL
   * the host dials (feed + chat + media) must be on this list. When empty
   * the only check is the `baseUrl` host.
   */
  allowHosts?: string[]
  /**
   * Allow dialing RFC1918 / loopback hosts. Defaults to `false`; set
   * `true` only for local development and trusted internal services.
   */
  allowPrivateNetwork?: boolean
  /**
   * Max bytes the host will buffer from a single feed or chat response.
   * Larger responses are rejected with a `responseTooLarge` error before
   * they are parsed.
   */
  maxResponseBytes?: number
  /**
   * Impression frequency cap. When set, the host will decline to serve
   * more than `maxImpressions` from this source inside a rolling
   * `windowMs` window. Tracked per-source in memory.
   */
  frequencyCap?: AdFrequencyCap
  /**
   * Targeting hints. The source is eligible when every present `*` set
   * has at least one match and the `exclude*` sets have no matches. The
   * host passes runtime context (`locale`, `path`, `tags`) when checking.
   */
  targeting?: AdTargetingConfig
  /**
   * Campaign / placement controls. Opaque to the plugin, but exposed
   * verbatim to the browser so the renderer can show a campaign label
   * and attach it to impression / click events.
   */
  campaign?: {
    id?: string
    placement?: string
    priority?: number
    weight?: number
  }
  /**
   * One or more field paths inside each feed record the host should use
   * to extract fields, instead of the normalizer's best-effort
   * conventions. Useful for unusual feed shapes; leave empty to use the
   * built-in normalizer.
   */
  mapping?: {
    id?: string
    type?: string
    title?: string
    body?: string
    mediaUrl?: string
    clickUrl?: string
    priceAmount?: string
    priceCurrency?: string
    originalPrice?: string
    imageBaseUrl?: string
  }
  /**
   * Click-tracking endpoint: when set, the browser POSTs click events to
   * this URL before opening the click-through. Failing to reach the
   * tracker must never block the user from opening the destination.
   */
  tracking?: {
    impressionUrl?: string
    clickUrl?: string
    conversionUrl?: string
  }
  /**
   * Named actions the browser can invoke on the source (e.g. "details",
   * "addToCart", "checkout"). Each action is its own endpoint call with
   * its own credentials, executed server-side through `/api/ad/action`.
   */
  actions?: AdActionConfig[]
}

/** Top-level plugin config: a list of sources plus which one is active. */
export interface AdConfig {
  /** When set, load (and shallow-merge) additional config from this path or `~`-prefixed home-relative path. */
  configFile?: string
  sources?: AdSourceConfig[]
  /** id of the source shown by default; falls back to the first entry. */
  activeSourceId?: string
  enabled?: boolean
}

// --- Schemastery validation schemas ---------------------------------------

const endpointSchema: z<AdEndpointConfig> = z.object({
  url: z.string().required(),
  method: z.union([z.const('GET'), z.const('POST'), z.const('PUT')]).default('GET'),
  headers: z.dict(z.string()).default({}),
  params: z.dict(z.string()).default({}),
  body: z.any(),
  responsePath: z.string(),
  timeoutMs: z.number().min(500).max(60_000).default(8_000),
}) as unknown as z<AdEndpointConfig>

const credentialsSchema: z<AdCredentials> = z.object({
  login: z.string(),
  loginEnv: z.string(),
  password: z.string(),
  passwordEnv: z.string(),
  apiKey: z.string(),
  apiKeyEnv: z.string(),
  token: z.string(),
  tokenEnv: z.string(),
  extra: z.dict(z.string()).default({}),
}) as unknown as z<AdCredentials>

const contentTypeSchema = z.union(AD_CONTENT_TYPES.map((t) => z.const(t))) as z<AdContentType>

/** Schemastery schema for one ad source; used to validate `config.sources`. */
export const adSourceSchema: z<AdSourceConfig> = z.object({
  id: z.string().required(),
  name: z.string().required(),
  enabled: z.boolean().default(true),
  contentTypes: z.array(contentTypeSchema).default([...DEFAULT_CONTENT_TYPES]),
  feed: endpointSchema,
  clickThroughUrl: z.string(),
  chat: z.object({
    endpoint: endpointSchema,
    auth: credentialsSchema,
    replyPath: z.string(),
    streaming: z.boolean().default(false),
    streamFormat: z.union([z.const('text'), z.const('sse')]).default('text'),
    streamTokenPath: z.string(),
  }),
  auth: credentialsSchema,
  pollIntervalMs: z.number().min(MIN_POLL_MS).max(MAX_POLL_MS).default(DEFAULT_POLL_MS),
  extra: z.dict(z.any()).default({}),

  // v0.3 additions.
  allowHosts: z.array(z.string()).default([]),
  allowPrivateNetwork: z.boolean().default(false),
  maxResponseBytes: z.number().min(1024).max(64 * 1024 * 1024),
  frequencyCap: z.object({
    maxImpressions: z.number().min(1).max(10_000).required(),
    windowMs: z.number().min(1000).max(7 * 24 * 60 * 60 * 1000).required(),
  }),
  targeting: z.object({
    locales: z.array(z.string()).default([]),
    paths: z.array(z.string()).default([]),
    excludePaths: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    excludeTags: z.array(z.string()).default([]),
  }),
  campaign: z.object({
    id: z.string(),
    placement: z.string(),
    priority: z.number(),
    weight: z.number(),
  }),
  mapping: z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    body: z.string(),
    mediaUrl: z.string(),
    clickUrl: z.string(),
    priceAmount: z.string(),
    priceCurrency: z.string(),
    originalPrice: z.string(),
    imageBaseUrl: z.string(),
  }),
  tracking: z.object({
    impressionUrl: z.string(),
    clickUrl: z.string(),
    conversionUrl: z.string(),
  }),
  actions: z.array(z.object({
    id: z.string().required(),
    label: z.string(),
    icon: z.string(),
    endpoint: endpointSchema,
    auth: credentialsSchema,
    autoInvoke: z.boolean().default(false),
  })).default([]),
}) as unknown as z<AdSourceConfig>

/** Schemastery schema for the whole plugin config. */
export const adConfigSchema: z<AdConfig> = z.object({
  configFile: z.string(),
  sources: z.array(adSourceSchema).default([]),
  activeSourceId: z.string(),
  enabled: z.boolean().default(true),
}) as unknown as z<AdConfig>

// --- Credential resolution ------------------------------------------------

/**
 * Resolve a `<field>` / `<field>Env` credential pair: the env var wins when
 * both are set, so a deployment can override a checked-in placeholder
 * without editing the config file.
 */
export function resolveSecret(plain: string | undefined, envName: string | undefined): string | undefined {
  if (envName !== undefined) {
    const fromEnv = process.env[envName]
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  }
  return plain
}

/** Resolved, ready-to-use credential values (secrets pulled from env where configured). */
export interface ResolvedAdCredentials {
  login?: string
  password?: string
  apiKey?: string
  token?: string
  extra: Record<string, string>
  /** Which of the `*Env` fields won (so the UI can show "using env"). */
  fromEnv: { login: boolean; password: boolean; apiKey: boolean; token: boolean }
}

/** Resolve every secret in a credential bundle in one pass. */
export function resolveCredentials(cred: AdCredentials | undefined): ResolvedAdCredentials {
  if (cred === undefined) {
    return { extra: {}, fromEnv: { login: false, password: false, apiKey: false, token: false } }
  }
  const loginEnv = resolveSecret(cred.login, cred.loginEnv)
  const passwordEnv = resolveSecret(cred.password, cred.passwordEnv)
  const apiKeyEnv = resolveSecret(cred.apiKey, cred.apiKeyEnv)
  const tokenEnv = resolveSecret(cred.token, cred.tokenEnv)
  return {
    login: loginEnv,
    password: passwordEnv,
    apiKey: apiKeyEnv,
    token: tokenEnv,
    extra: cred.extra ?? {},
    fromEnv: {
      login: cred.loginEnv !== undefined && cred.login === undefined ? false : (cred.loginEnv !== undefined && loginEnv !== undefined),
      password: cred.passwordEnv !== undefined && cred.password === undefined ? false : (cred.passwordEnv !== undefined && passwordEnv !== undefined),
      apiKey: cred.apiKeyEnv !== undefined && cred.apiKey === undefined ? false : (cred.apiKeyEnv !== undefined && apiKeyEnv !== undefined),
      token: cred.tokenEnv !== undefined && cred.token === undefined ? false : (cred.tokenEnv !== undefined && tokenEnv !== undefined),
    },
  }
}

// --- File-based config loading -------------------------------------------

/**
 * Read a JSON config file from disk and shallow-merge it under the inline
 * `config` object. Inline values win (the file is the "defaults" layer).
 * Returns a new object; the input is not mutated.
 */
export function loadConfigFromFile(
  config: AdConfig,
  env: NodeJS.ProcessEnv = process.env,
): AdConfig {
  const file = config.configFile ?? env.DSH_AD_CONFIG
  if (file === undefined || file === '') return config
  const path = resolvePath(file.replace(/^~(?=\/|\\)/, env.HOME ?? process.cwd()))
  if (!existsSync(path)) return config
  const raw = readFileSync(path, 'utf8')
  let parsed: Partial<AdConfig> | undefined
  // JSON first (fast path); on SyntaxError fall back to YAML so the same
  // config file extension convention used elsewhere in the dsh ecosystem
  // (`.yaml` / `.yml`) works without manual conversion.
  try {
    parsed = JSON.parse(raw) as Partial<AdConfig>
  } catch {
    try {
      const loaded = yaml.load(raw)
      if (loaded !== null && typeof loaded === 'object') {
        parsed = loaded as Partial<AdConfig>
      }
    } catch {
      return config
    }
  }
  if (parsed === undefined) return config
  return { ...parsed, ...config, sources: mergeSources(parsed.sources, config.sources) }
}

function mergeSources(
  a: AdSourceConfig[] | undefined,
  b: AdSourceConfig[] | undefined,
): AdSourceConfig[] | undefined {
  if (a === undefined && b === undefined) return undefined
  if (a === undefined) return b
  if (b === undefined) return a
  const byId = new Map<string, AdSourceConfig>()
  for (const s of a) byId.set(s.id, s)
  for (const s of b) byId.set(s.id, { ...byId.get(s.id), ...s } as AdSourceConfig)
  return [...byId.values()]
}
