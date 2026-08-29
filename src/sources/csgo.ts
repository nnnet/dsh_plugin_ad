/**
 * dsh-ad — built-in CS:GO Market source preset.
 *
 * Opinionated configuration for the [market.csgo.com](https://market.csgo.com)
 * skin marketplace: the price feed URL, the `cdn2.csgo.com` image CDN URL
 * pattern, the click-through URL, and the credential env-var names. Use
 * `buildCsgoMarketSource({ loginEnv, passwordEnv, currency, imageWidth })`
 * to get a ready-to-use `AdSourceConfig` you can drop into `sources[]` with
 * one line.
 *
 * This is *not* required — the same source can be configured by hand in
 * YAML (see `example.config.yaml`). The preset just keeps the moving parts
 * (currency switch, image width, feed host, image CDN host) in code so a
 * tool that wants to inject the source at runtime doesn't have to rebuild
 * the URL pattern by hand.
 *
 * ## API
 *
 * The CS:GO price feed is a flat JSON map of `hash_name -> price (cents)`.
 * The image CDN serves a single webp at:
 *   `https://cdn2.csgo.com/item/image/width=<W>/<hash_name>.webp`
 * The market cabinet's "buy" page is at:
 *   `https://market.csgo.com/item/<hash_name>`
 *
 * Both hosts (`market.csgo.com`, `cdn2.csgo.com`) are added to the
 * `allowHosts` list automatically. The credentials are read from
 * `CSGO_LOGIN` / `CSGO_PASSWORD` by default; override with `loginEnv` /
 * `passwordEnv` if your deployment uses different names.
 * @module dsh_plugin_ad/sources/csgo
 */

import type { AdSourceConfig } from '../config.ts'
import { csgoImageUrl } from './image-templates.ts'

/** Build a CS:GO market source config ready to drop into `sources[]`. */
export interface CsgoMarketOptions {
  /** Currency code used to fetch prices: 'RUB' | 'USD' | 'EUR'. Default 'RUB'. */
  currency?: 'RUB' | 'USD' | 'EUR'
  /** Image width in pixels. Default 458. */
  imageWidth?: number
  /** Override the env var the host reads for the buyer's login. */
  loginEnv?: string
  /** Override the env var the host reads for the buyer's password. */
  passwordEnv?: string
  /** Max items the host will keep in cache. Default 50. */
  maxItems?: number
  /** Poll interval (ms). Default 60000. */
  pollIntervalMs?: number
  /** Impression frequency cap. Default { 5 impressions / 10 minutes }. */
  frequencyCap?: { maxImpressions: number; windowMs: number }
  /** Restrict to specific paths (e.g. ['/shop']). */
  targetingPaths?: string[]
  /** Restrict to specific locales (e.g. ['en', 'zh']). */
  targetingLocales?: string[]
  /** Source id; default 'csgo-market'. */
  id?: string
  /** Source display name; default 'CS:GO Market'. */
  name?: string
  /** Disable the source without removing it from config. */
  enabled?: boolean
}

export function buildCsgoMarketSource(opts: CsgoMarketOptions = {}): AdSourceConfig {
  const currency = opts.currency ?? 'RUB'
  const imageWidth = opts.imageWidth ?? 458
  const id = opts.id ?? 'csgo-market'
  const name = opts.name ?? 'CS:GO Market'
  const loginEnv = opts.loginEnv ?? 'CSGO_LOGIN'
  const passwordEnv = opts.passwordEnv ?? 'CSGO_PASSWORD'

  return {
    id,
    name,
    enabled: opts.enabled ?? true,
    contentTypes: ['image', 'product', 'chat'],
    allowHosts: ['market.csgo.com', 'cdn.csgo.com', 'cdn2.csgo.com'],
    allowPrivateNetwork: false,
    maxResponseBytes: 1024 * 1024,
    pollIntervalMs: opts.pollIntervalMs ?? 60_000,
    auth: {
      loginEnv,
      passwordEnv,
      extra: { clientId: 'dsh-ad-widget' },
    },
    feed: {
      url: `https://market.csgo.com/api/v2/prices/${currency}.json`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': `dsh-ad/0.2 (+https://github.com/nnnet/dsh_plugin_ad)`,
      },
      timeoutMs: 8_000,
    },
    // Map each feed entry ({ "<hash_name>": <price_cents> }) into a
    // marketplace product. The adapter turns the flat map into a list;
    // each entry has a single key (the hash_name) with the price as its
    // value. The `__BASE__` placeholder for imageBaseUrl is a sentinel
    // that the adapter expands to a real URL via `csgoImageUrl()`.
    mapping: {
      id: '__HASH_NAME__',
      title: '__HASH_NAME__',
      priceAmount: '__PRICE__',
      imageBaseUrl: '__BASE__',
    },
    clickThroughUrl: `https://market.csgo.com/item/{itemId}?utm_source=dsh-ad`,
    frequencyCap: opts.frequencyCap ?? { maxImpressions: 5, windowMs: 600_000 },
    targeting: {
      ...(opts.targetingLocales !== undefined ? { locales: opts.targetingLocales } : {}),
      ...(opts.targetingPaths !== undefined ? { paths: opts.targetingPaths } : {}),
    },
    campaign: {
      id: 'csgo-market-rotator',
      placement: 'dsh-ad',
      priority: 100,
      weight: 10,
    },
    extra: {
      __csgoImageWidth: imageWidth,
      __csgoCurrency: currency,
    },
    // No built-in chat; a CS:GO market source without an assistant
    // doesn't need a chat endpoint. Add one in user config to enable.
  }
}

/**
 * Normalize one CS:GO price-feed entry into the marketplace shape.
 * The feed is a flat map: `{ "<hash_name>": <price_cents> }`, so the
 * adapter needs to be told the key/value paths. Use this with a custom
 * source's `mapping` if you build your own config instead of
 * `buildCsgoMarketSource`.
 */
export function csgoFeedEntry(hashName: string, priceCents: number, imageWidth = 458): {
  id: string
  title: string
  price: number
  currency: 'RUB' | 'USD' | 'EUR'
  imageUrl: string
  clickUrl: string
} {
  return {
    id: hashName,
    title: hashName,
    price: priceCents,
    currency: 'RUB',
    imageUrl: csgoImageUrl(hashName, imageWidth),
    clickUrl: `https://market.csgo.com/item/${encodeURIComponent(hashName)}`,
  }
}
