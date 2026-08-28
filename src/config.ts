import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_POLL_MS, MAX_ITEMS, MAX_POLL_MS, MIN_POLL_MS, REQUEST_TIMEOUT_MS } from './constants.ts'

export type SecretValue = string | { env: string }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface AdSourceAuth {
  username?: SecretValue
  password?: SecretValue
  token?: SecretValue
  tokenHeader?: string
  extraHeaders?: Record<string, string | SecretValue>
}

export interface AdRequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  path?: string
  query?: Record<string, string | number | boolean>
  headers?: Record<string, string | SecretValue>
  body?: JsonValue
}

export interface AdActionConfig extends AdRequestConfig {
  /** Open a URL instead of calling an API. If both are present, url wins. */
  url?: string
  /** Response path containing the URL when url is omitted. */
  urlPath?: string
}

export interface AdMappingConfig {
  /** Path to the array of creatives. */
  itemsPath?: string
  /** Paths inside each creative. */
  idPath?: string
  typePath?: string
  titlePath?: string
  textPath?: string
  descriptionPath?: string
  imagePath?: string
  mediaPath?: string
  urlPath?: string
  assistantIdPath?: string
  /** Extra fields are copied from the raw creative object. */
  raw?: boolean
}

export interface AdSourceConfig {
  id: string
  name: string | { en?: string; zh?: string }
  baseUrl: string
  enabled?: boolean
  allowHosts?: string[]
  allowPrivateNetwork?: boolean
  auth?: AdSourceAuth
  request?: AdRequestConfig
  mapping?: AdMappingConfig
  actions?: Record<string, AdActionConfig>
  assistant?: {
    action?: string
    sessionField?: string
    messageField?: string
    historyField?: string
  }
  pollIntervalMs?: number
  timeoutMs?: number
  maxItems?: number
  /** Arbitrary source-specific metadata; never interpreted by the plugin. */
  metadata?: Record<string, JsonValue>
}

export interface AdPetConfig {
  enabled?: boolean
  source?: string
  sources?: AdSourceConfig[]
  configFile?: string
  pollIntervalMs?: number
}

export interface ResolvedAdPetConfig {
  enabled: boolean
  source?: string
  sources: AdSourceConfig[]
  pollIntervalMs: number
}

export function secret(value: SecretValue | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  return env[value.env]
}

function clampPoll(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_POLL_MS
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(value)))
}

export function resolveConfig(input: AdPetConfig = {}, env: NodeJS.ProcessEnv = process.env): ResolvedAdPetConfig {
  let fileConfig: Partial<AdPetConfig> = {}
  const file = input.configFile ?? env.DSH_AD_PET_CONFIG
  if (file) {
    const path = resolve(file.replace(/^~(?=\/|\\)/, env.HOME ?? process.cwd()))
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdPetConfig>
      fileConfig = parsed
    }
  }
  const merged = { ...fileConfig, ...input }
  const sources = (merged.sources ?? []).map((source) => ({
    ...source,
    enabled: source.enabled ?? true,
    pollIntervalMs: clampPoll(source.pollIntervalMs ?? merged.pollIntervalMs),
    timeoutMs: Math.min(120_000, Math.max(1_000, Math.round(source.timeoutMs ?? REQUEST_TIMEOUT_MS))),
    maxItems: Math.min(MAX_ITEMS, Math.max(1, Math.round(source.maxItems ?? MAX_ITEMS))),
  }))
  return { enabled: merged.enabled ?? true, source: merged.source, sources, pollIntervalMs: clampPoll(merged.pollIntervalMs) }
}

/** Dot-path lookup used by mappings and URL/body templates. */
export function getPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  let current: unknown = value
  for (const part of path.split('.')) {
    if (part === '') continue
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)]
    else if (typeof current === 'object' && current !== null) current = (current as Record<string, unknown>)[part]
    else return undefined
  }
  return current
}

export function renderTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') return value.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_, path) => String(getPath(context, path) ?? ''))
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, context))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, context)]))
  return value
}
