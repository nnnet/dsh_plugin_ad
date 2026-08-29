/**
 * dsh-ad — marketplace renderer (Phase 2).
 *
 * This module is the marketplace-specific glue between the host's generic
 * `AdItem` and the client's `MarketplaceRenderer` component. The renderer
 * is purely a presentational thing — every product card it shows comes from
 * the same `AdItem` contract that the simpler `SimpleCreative` consumes,
 * so adding a new marketplace source never requires touching the renderer.
 *
 * This file exists to:
 *   1. Document the marketplace renderer's expected `AdItem` shape (price,
 *      media, CTAs, details, click-through) in one place.
 *   2. Provide a `normalizeMarketplaceItem` helper that vendors with very
 *      non-standard feeds can call instead of the generic `normalizeAdItem`
 *      — it forces the result into the `product` type and accepts a few
 *      marketplace-specific field names (sku, productId, brand, rating,
 *      stock, gallery) on top of the standard conventions.
 *   3. Provide a `summarizeMarketplaceItem` for the widget's source picker
 *      so each marketplace source's name can carry the configured campaign
 *      label, brand, or stock-state alongside.
 * @module dsh_plugin_ad/marketplace-renderer
 */

import type { AdItem, AdMedia, AdPrice, AdCta, AdDetails } from './adapter.ts'
import { normalizeAdItem } from './adapter.ts'
import type { AdSourceConfig } from './config.ts'
import { getPath } from './mapping.ts'

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

/** Marketplace-specific fields an item may carry, layered on top of `AdItem`. */
export interface MarketplaceExtras {
  sku?: string
  productId?: string
  brand?: string
  rating?: number
  inStock?: boolean
  /** Optional click-through override at the item level (wins over the source's). */
  overrideClickUrl?: string
}

/** Read marketplace extras from a raw record using common field-name conventions. */
export function readMarketplaceExtras(record: unknown): MarketplaceExtras {
  if (record === null || typeof record !== 'object') return {}
  const r = record as Record<string, unknown>
  return {
    sku: str(r.sku) ?? str(r.productSku),
    productId: str(r.productId) ?? str(r.product_id),
    brand: str(r.brand) ?? str(r.manufacturer) ?? str(r.maker),
    rating: num(r.rating) ?? num(r.stars) ?? num(r.score),
    inStock: bool(r.inStock) ?? bool(r.in_stock) ?? bool(r.available),
    overrideClickUrl: str(r.buyUrl) ?? str(r.deeplink) ?? str(r.deepLink) ?? str(r.affiliateUrl),
  }
}

/**
 * Force a normalized item into the `product` type, lifting marketplace-
 * specific fields onto the resulting AdItem. Always re-runs the standard
 * normalizer first so the result is shape-compatible with the renderer's
 * `AdItemView`; the marketplace-specific extra fields are returned in a
 * parallel object callers can attach to the raw record.
 */
export function normalizeMarketplaceItem(record: unknown, index: number, source?: AdSourceConfig): {
  item: AdItem
  extras: MarketplaceExtras
} | undefined {
  const item = normalizeAdItem(record, index, source)
  if (item === undefined) return undefined
  const extras = readMarketplaceExtras(record)
  const result: AdItem = { ...item, type: 'product' }
  // Prefer the item-level click URL when the source record supplied one.
  if (extras.overrideClickUrl !== undefined) result.clickUrl = extras.overrideClickUrl
  return { item: result, extras }
}

/** Pick the first non-empty media entry's URL (handy for cart thumbnails). */
export function firstMediaUrl(item: AdItem): string | undefined {
  return item.mediaUrl ?? item.media?.[0]?.url
}

/** Format a price as a one-line label ("RUB 12.50", "Free", etc). */
export function formatPriceLabel(price: AdPrice | undefined): string {
  if (price === undefined) return ''
  if (price.amount === 0) return 'Free'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amount)
  } catch {
    return `${price.amount.toFixed(2)} ${price.currency}`
  }
}

/** Build the default CTA row for a marketplace item when the feed didn't supply one. */
export function defaultCtas(buyUrl: string | undefined): AdCta[] {
  return [
    { id: 'buy', label: '', kind: 'buy', url: buyUrl },
    { id: 'cart', label: '', kind: 'cart' },
  ]
}

/** Build a "details" block from marketplace extras, when the feed didn't supply one. */
export function defaultDetails(extras: MarketplaceExtras): AdDetails | undefined {
  const specs: Record<string, string> = {}
  if (extras.brand !== undefined) specs['Brand'] = extras.brand
  if (extras.sku !== undefined) specs['SKU'] = extras.sku
  if (extras.productId !== undefined) specs['Product ID'] = extras.productId
  if (extras.rating !== undefined) specs['Rating'] = String(extras.rating)
  if (extras.inStock === false) specs['Availability'] = 'Out of stock'
  if (Object.keys(specs).length === 0) return undefined
  return { specs }
}

/** Read the source's campaign label for the widget's source picker badge. */
export function campaignLabel(source: AdSourceConfig): string | undefined {
  const label = str(getPath(source, 'campaign.placement')) ?? str(getPath(source, 'campaign.id'))
  if (label === undefined) return undefined
  const weight = num(getPath(source, 'campaign.weight'))
  const priority = num(getPath(source, 'campaign.priority'))
  const tail: string[] = []
  if (priority !== undefined) tail.push(`p${priority}`)
  if (weight !== undefined) tail.push(`w${weight}`)
  return tail.length === 0 ? label : `${label} (${tail.join('/')})`
}

/** Convert a list of media entries to a fully-qualified URL list. */
export function absolutizeMedia(media: AdMedia[], baseUrl: string | undefined): AdMedia[] {
  if (baseUrl === undefined) return media
  return media.map((entry) => {
    try { new URL(entry.url); return entry } catch {
      return { ...entry, url: new URL(entry.url, baseUrl).toString() }
    }
  })
}
