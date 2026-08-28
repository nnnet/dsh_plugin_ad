/**
 * dsh-ad config surface — describes one or more *ad sources* the plugin can
 * pull content from and click through to. A source is deliberately generic:
 * it can be a static creative feed (mp4/gif/image/text), a message-style
 * feed (e.g. a marketplace's "today's picks" list), or a live chat endpoint
 * backed by an AI shopping assistant. Every network shape (headers, body,
 * response field to read the payload from) is configurable so one plugin
 * install can point at very different backends without a code change.
 * @module @linxin666/dsh-ad/config
 */

import z from 'schemastery'

/** Content shapes an ad source can hand back. A source may support several. */
export type AdContentType = 'video' | 'gif' | 'image' | 'text' | 'message' | 'chat'

export const AD_CONTENT_TYPES: AdContentType[] = ['video', 'gif', 'image', 'text', 'message', 'chat']

/**
 * Credential bundle for a source's buyer/account cabinet. Every secret field
 * has a matching `<field>Env` sibling: set the `*Env` variant to read the
 * secret from `process.env` at request time instead of storing it in the
 * config file. Prefer the env-var form for anything checked into source
 * control or shared between deployments — the plain fields exist for local
 * experimentation and quick setups where that risk is accepted.
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
  /** Request timeout in ms. Default 8000. */
  timeoutMs?: number
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
}

/** Top-level plugin config: a list of sources plus which one is active. */
export interface AdConfig {
  sources?: AdSourceConfig[]
  /** id of the source shown by default; falls back to the first entry. */
  activeSourceId?: string
  enabled?: boolean
}

const endpointSchema: z<AdEndpointConfig> = z.object({
  url: z.string().required(),
  method: z.union([z.const('GET'), z.const('POST'), z.const('PUT')]).default('GET'),
  headers: z.dict(z.string()).default({}),
  params: z.dict(z.string()).default({}),
  body: z.any(),
  responsePath: z.string(),
  timeoutMs: z.number().min(500).max(60_000).default(8000),
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
  contentTypes: z.array(contentTypeSchema).default(['image']),
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
  pollIntervalMs: z.number().min(2000).max(3_600_000).default(60_000),
  extra: z.dict(z.any()).default({}),
}) as unknown as z<AdSourceConfig>

/** Schemastery schema for the whole plugin config. */
export const adConfigSchema: z<AdConfig> = z.object({
  sources: z.array(adSourceSchema).default([]),
  activeSourceId: z.string(),
  enabled: z.boolean().default(true),
}) as unknown as z<AdConfig>

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
}

/** Resolve every secret in a credential bundle in one pass. */
export function resolveCredentials(cred: AdCredentials | undefined): ResolvedAdCredentials {
  if (cred === undefined) return { extra: {} }
  return {
    login: resolveSecret(cred.login, cred.loginEnv),
    password: resolveSecret(cred.password, cred.passwordEnv),
    apiKey: resolveSecret(cred.apiKey, cred.apiKeyEnv),
    token: resolveSecret(cred.token, cred.tokenEnv),
    extra: cred.extra ?? {},
  }
}
