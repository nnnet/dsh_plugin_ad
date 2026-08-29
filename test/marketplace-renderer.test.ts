/**
 * Unit tests for `src/marketplace-renderer.ts`: marketplace-specific
 * normalization, CTA defaults, campaign-label formatting, and media
 * absolutization. Run with `npx vitest`.
 */

import { describe, expect, it } from 'vitest'
import {
  normalizeMarketplaceItem,
  readMarketplaceExtras,
  formatPriceLabel,
  defaultCtas,
  defaultDetails,
  campaignLabel,
  absolutizeMedia,
  firstMediaUrl,
} from '../src/marketplace-renderer.ts'

describe('marketplace: readMarketplaceExtras', () => {
  it('reads brand, sku, rating, inStock from common field names', () => {
    const extras = readMarketplaceExtras({
      sku: 'AK-47-REDLINE',
      brand: 'Valve',
      rating: 4.7,
      inStock: true,
    })
    expect(extras).toEqual({
      sku: 'AK-47-REDLINE',
      productId: undefined,
      brand: 'Valve',
      rating: 4.7,
      inStock: true,
      overrideClickUrl: undefined,
    })
  })

  it('accepts snake_case fallbacks', () => {
    const extras = readMarketplaceExtras({
      product_id: 'p-123',
      in_stock: false,
      deep_link: 'https://example.com/x',
    })
    expect(extras.productId).toBe('p-123')
    expect(extras.inStock).toBe(false)
    expect(extras.overrideClickUrl).toBe('https://example.com/x')
  })
})

describe('marketplace: normalizeMarketplaceItem', () => {
  it('forces the type to product', () => {
    const out = normalizeMarketplaceItem({ id: 'x', name: 'AK-47 Redline', price: 1299 }, 0)
    expect(out).toBeDefined()
    expect(out!.item.type).toBe('product')
    expect(out!.item.title).toBe('AK-47 Redline')
  })

  it('returns undefined for null / non-object records', () => {
    expect(normalizeMarketplaceItem(null, 0)).toBeUndefined()
    expect(normalizeMarketplaceItem('oops', 0)).toBeUndefined()
  })

  it('applies mapping overrides from the source config', () => {
    const out = normalizeMarketplaceItem(
      { hash_name: 'AK-47 | Redline (FT)', price: 1299 },
      0,
      {
        id: 'csgo',
        name: 'CS:GO',
        contentTypes: ['product'],
        mapping: { id: 'hash_name', priceAmount: 'price' },
      } as never,
    )
    expect(out).toBeDefined()
    expect(out!.item.id).toBe('AK-47 | Redline (FT)')
  })

  it('prefers item-level overrideClickUrl over the source click-through', () => {
    const out = normalizeMarketplaceItem(
      { id: 'x', buyUrl: 'https://buy.example/x' },
      0,
      { id: 's', name: 's', contentTypes: ['product'] } as never,
    )
    expect(out!.item.clickUrl).toBe('https://buy.example/x')
  })
})

describe('marketplace: formatPriceLabel', () => {
  it('returns "Free" for amount 0', () => {
    expect(formatPriceLabel({ amount: 0, currency: 'USD' })).toBe('Free')
  })

  it('formats via Intl.NumberFormat', () => {
    const label = formatPriceLabel({ amount: 1299, currency: 'RUB' })
    expect(label).toMatch(/1\s*299/)
  })

  it('returns "" for undefined', () => {
    expect(formatPriceLabel(undefined)).toBe('')
  })
})

describe('marketplace: defaultCtas', () => {
  it('returns a buy + cart row', () => {
    const ctas = defaultCtas('https://buy.example/x')
    expect(ctas).toHaveLength(2)
    expect(ctas[0]!.kind).toBe('buy')
    expect(ctas[0]!.url).toBe('https://buy.example/x')
    expect(ctas[1]!.kind).toBe('cart')
  })
})

describe('marketplace: defaultDetails', () => {
  it('builds a specs table from marketplace extras', () => {
    const details = defaultDetails({ brand: 'Valve', sku: 'AK-47', rating: 4.5 })
    expect(details?.specs).toEqual({ Brand: 'Valve', SKU: 'AK-47', Rating: '4.5' })
  })

  it('returns undefined when extras are empty', () => {
    expect(defaultDetails({})).toBeUndefined()
  })

  it('marks out-of-stock items', () => {
    const details = defaultDetails({ inStock: false })
    expect(details?.specs?.['Availability']).toBe('Out of stock')
  })
})

describe('marketplace: campaignLabel', () => {
  it('returns undefined when no campaign is configured', () => {
    expect(campaignLabel({ id: 'x', name: 'x', contentTypes: ['product'] } as never)).toBeUndefined()
  })

  it('returns the placement when set', () => {
    const label = campaignLabel({
      id: 'x', name: 'x', contentTypes: ['product'],
      campaign: { placement: 'companion-widget', priority: 100, weight: 10 },
    } as never)
    expect(label).toBe('companion-widget (p100/w10)')
  })
})

describe('marketplace: absolutizeMedia', () => {
  it('passes through absolute URLs unchanged', () => {
    const out = absolutizeMedia([{ kind: 'image', url: 'https://x.com/y.webp' }], 'https://cdn.com/')
    expect(out[0]!.url).toBe('https://x.com/y.webp')
  })

  it('prefixes relative paths', () => {
    const out = absolutizeMedia([{ kind: 'image', url: '/y.webp' }], 'https://cdn.com')
    expect(out[0]!.url).toBe('https://cdn.com/y.webp')
  })
})

describe('marketplace: firstMediaUrl', () => {
  it('prefers mediaUrl when present', () => {
    expect(firstMediaUrl({ id: 'x', type: 'product', mediaUrl: 'https://a', media: [{ kind: 'image', url: 'https://b' }] } as never)).toBe('https://a')
  })

  it('falls back to the first media entry', () => {
    expect(firstMediaUrl({ id: 'x', type: 'product', media: [{ kind: 'image', url: 'https://b' }] } as never)).toBe('https://b')
  })

  it('returns undefined when there is no media', () => {
    expect(firstMediaUrl({ id: 'x', type: 'product' } as never)).toBeUndefined()
  })
})
