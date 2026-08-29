/**
 * dsh-ad — image-URL templates for known ad sources.
 *
 * Some marketplaces (CS:GO Market, Steam Community Market, ...) compute
 * the image URL from a hash/id using a fixed pattern. Keeping the
 * patterns in one file makes it easy to add a new source without
 * rebuilding URL helpers scattered across the codebase.
 * @module dsh_plugin_ad/sources/image-templates
 */

/** CS:GO Market image CDN: `https://cdn2.csgo.com/item/image/width=<W>/<hash_name>.webp`. */
export function csgoImageUrl(hashName: string, width = 458): string {
  return `https://cdn2.csgo.com/item/image/width=${width}/${encodeURIComponent(hashName)}.webp`
}

/** Steam Community Market image CDN: `https://community.cloudflare.steamstatic.com/economy/image/<icon_url>`. */
export function steamImageUrl(iconUrl: string): string {
  return `https://community.cloudflare.steamstatic.com/economy/image/${iconUrl}`
}

/** Steam Community Market listing page: `https://steamcommunity.com/market/listings/<appid>/<hash_name>`. */
export function steamListingUrl(appId: string | number, hashName: string): string {
  return `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(hashName)}`
}

/** Dota 2 market price feed (mirrors the CS:GO shape). */
export function dotaPriceFeedUrl(currency: 'RUB' | 'USD' | 'EUR' = 'RUB'): string {
  return `https://market.dota2.net/api/v2/prices/${currency}.json`
}

/** Dota 2 market image CDN. */
export function dotaImageUrl(hashName: string, width = 458): string {
  return `https://cdn.dota2.net/item/image/width=${width}/${encodeURIComponent(hashName)}.webp`
}
