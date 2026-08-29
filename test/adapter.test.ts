/**
 * Unit tests for the CS:GO market flat-map shape in the adapter. Run with
 * `npx vitest`.
 */

import { describe, expect, it } from 'vitest'
import { normalizeAdItem, normalizeAdFeed } from '../src/adapter.ts'
import { buildCsgoMarketSource } from '../src/sources/index.ts'

describe('adapter: CS:GO flat-map shape', () => {
  it('rebuilds a flat map into one product per hash_name', () => {
    const source = buildCsgoMarketSource()
    const items = normalizeAdFeed(
      { 'AK-47 | Redline (FT)': 1299, 'USP-S | Printstream (BS)': 850 },
      source,
    )
    expect(items).toHaveLength(2)
    const ak = items.find((i) => i.id === 'AK-47 | Redline (FT)')
    expect(ak).toBeDefined()
    expect(ak!.type).toBe('product')
    expect(ak!.title).toBe('AK-47 | Redline (FT)')
    expect(ak!.price?.amount).toBe(1299)
    expect(ak!.media?.[0]?.url).toContain('cdn2.csgo.com/item/image/width=458/')
  })

  it('synthesizes a cdn2.csgo.com webp URL from the hash_name', () => {
    const source = buildCsgoMarketSource({ imageWidth: 256 })
    const items = normalizeAdFeed(
      { 'USP-S | Printstream (BS)': 850 },
      source,
    )
    expect(items[0]!.media?.[0]?.url).toBe('https://cdn2.csgo.com/item/image/width=256/USP-S%20%7C%20Printstream%20(BS).webp')
  })

  it('click-through URL uses the hash_name as the item id', () => {
    const source = buildCsgoMarketSource()
    const items = normalizeAdFeed({ 'AK-47 | Redline (FT)': 1299 }, source)
    // Service.resolveClickThrough is what fills the {itemId} placeholder;
    // here we just assert the source's template is correct.
    expect(source.clickThroughUrl).toBe('https://market.csgo.com/item/{itemId}?utm_source=dsh-ad')
    expect(items[0]!.id).toBe('AK-47 | Redline (FT)')
  })
})

describe('adapter: standard marketplace record', () => {
  it('normalizes a conventional marketplace product record', () => {
    const item = normalizeAdItem({
      id: 'ak-redline',
      name: 'AK-47 Redline',
      price: { amount: 1299, currency: 'USD' },
      image: 'https://cdn.example.com/ak.webp',
      gallery: ['https://cdn.example.com/ak-2.webp', 'https://cdn.example.com/ak-3.mp4'],
      actions: [{ kind: 'buy', label: 'Buy' }],
      description: 'A classic redline skin.',
    }, 0)
    expect(item).toBeDefined()
    expect(item!.type).toBe('product')
    expect(item!.title).toBe('AK-47 Redline')
    expect(item!.price?.amount).toBe(1299)
    expect(item!.media).toHaveLength(3)
    expect(item!.media?.[2]?.kind).toBe('video')
    expect(item!.ctas?.[0]?.kind).toBe('buy')
  })
})
