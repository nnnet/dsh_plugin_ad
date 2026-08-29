/**
 * Unit tests for `src/sources/*` and the CS:GO image URL helpers. Run with
 * `npx vitest`.
 */

import { describe, expect, it } from 'vitest'
import {
  csgoImageUrl,
  steamImageUrl,
  steamListingUrl,
  dotaPriceFeedUrl,
  dotaImageUrl,
  buildCsgoMarketSource,
  csgoFeedEntry,
} from '../src/sources/index.ts'

describe('sources: image URL templates', () => {
  it('builds a CS:GO image URL with the configured width', () => {
    expect(csgoImageUrl('AK-47 | Redline (FT)', 458))
      .toBe('https://cdn2.csgo.com/item/image/width=458/AK-47%20%7C%20Redline%20(FT).webp')
  })

  it('defaults to width 458', () => {
    expect(csgoImageUrl('USP-S | Printstream'))
      .toBe('https://cdn2.csgo.com/item/image/width=458/USP-S%20%7C%20Printstream.webp')
  })

  it('builds a Steam Community image URL from an icon_url', () => {
    expect(steamImageUrl('IWefdbWqfdfdsfdsfdsfsdfsdfsd'))
      .toBe('https://community.cloudflare.steamstatic.com/economy/image/IWefdbWqfdfdsfdsfdsfsdfsdfsd')
  })

  it('builds a Steam Community listing URL', () => {
    expect(steamListingUrl(730, 'AK-47 | Redline (FT)'))
      .toBe('https://steamcommunity.com/market/listings/730/AK-47%20%7C%20Redline%20(FT)')
  })

  it('builds a Dota 2 price feed URL with the right currency', () => {
    expect(dotaPriceFeedUrl('USD'))
      .toBe('https://market.dota2.net/api/v2/prices/USD.json')
  })

  it('builds a Dota 2 image URL with the configured width', () => {
    expect(dotaImageUrl('Inscribed Boots of the Emerald Guardian', 256))
      .toBe('https://cdn.dota2.net/item/image/width=256/Inscribed%20Boots%20of%20the%20Emerald%20Guardian.webp')
  })
})

describe('sources: buildCsgoMarketSource', () => {
  it('uses CSGO_LOGIN and CSGO_PASSWORD by default', () => {
    const src = buildCsgoMarketSource()
    expect(src.id).toBe('csgo-market')
    expect(src.name).toBe('CS:GO Market')
    expect(src.auth?.loginEnv).toBe('CSGO_LOGIN')
    expect(src.auth?.passwordEnv).toBe('CSGO_PASSWORD')
  })

  it('honors a custom currency', () => {
    const src = buildCsgoMarketSource({ currency: 'USD' })
    expect(src.feed?.url).toContain('/prices/USD.json')
  })

  it('honors a custom image width', () => {
    const src = buildCsgoMarketSource({ imageWidth: 256 })
    expect((src.extra as Record<string, unknown>)?.['__csgoImageWidth']).toBe(256)
  })

  it('honors a custom id and name', () => {
    const src = buildCsgoMarketSource({ id: 'skins', name: 'Skins' })
    expect(src.id).toBe('skins')
    expect(src.name).toBe('Skins')
  })

  it('uses the special `__HASH_NAME__` / `__PRICE__` / `__BASE__` mapping sentinels', () => {
    const src = buildCsgoMarketSource()
    expect(src.mapping?.id).toBe('__HASH_NAME__')
    expect(src.mapping?.priceAmount).toBe('__PRICE__')
    expect(src.mapping?.imageBaseUrl).toBe('__BASE__')
  })

  it('puts the right hosts in the allowlist', () => {
    const src = buildCsgoMarketSource()
    expect(src.allowHosts).toEqual(['market.csgo.com', 'cdn.csgo.com', 'cdn2.csgo.com'])
  })

  it('omits a default frequency cap so the widget keeps rotating, and sets the campaign placement', () => {
    // v0.7: the default 5/10min cap made the widget go silent after
    // ~2.5 minutes, which users read as "the source has no items".
    // Opt-in via `opts.frequencyCap` if throttling is wanted.
    const src = buildCsgoMarketSource()
    expect(src.frequencyCap).toBeUndefined()
    expect(src.campaign?.placement).toBe('dsh-ad')
  })

  it('overrides the frequency cap when supplied', () => {
    const src = buildCsgoMarketSource({ frequencyCap: { maxImpressions: 1, windowMs: 60_000 } })
    expect(src.frequencyCap?.maxImpressions).toBe(1)
  })
})

describe('sources: csgoFeedEntry', () => {
  it('builds a marketplace-shaped record from hash_name + price', () => {
    const entry = csgoFeedEntry('AK-47 | Redline (FT)', 1299)
    expect(entry.id).toBe('AK-47 | Redline (FT)')
    expect(entry.price).toBe(1299)
    expect(entry.imageUrl).toBe(csgoImageUrl('AK-47 | Redline (FT)'))
    expect(entry.clickUrl).toContain('market.csgo.com/item/')
  })
})
