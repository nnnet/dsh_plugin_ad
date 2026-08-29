/**
 * dsh-ad — built-in source adapters.
 *
 * Every export here is a pure function (or a thin wrapper) that produces
 * an `AdSourceConfig` you can drop into `sources[]`. None of these
 * presets call out to the network themselves; they're just convenient
 * ways to avoid re-typing the same URL patterns and credential
 * conventions.
 *
 * Adding a new built-in adapter: write it as a `build*` function that
 * returns a fully-formed `AdSourceConfig` (use the `AdSourceConfig`
 * fields directly rather than going through `buildCsgoMarketSource`-
 * style wrappers; presets are free to override every field).
 * @module dsh_plugin_ad/sources
 */

export { buildCsgoMarketSource, csgoFeedEntry } from './csgo.ts'
export type { CsgoMarketOptions } from './csgo.ts'
export { csgoImageUrl, steamImageUrl, steamListingUrl, dotaPriceFeedUrl, dotaImageUrl } from './image-templates.ts'
