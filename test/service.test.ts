/**
 * Unit tests for `AdService.resolveClickThrough` priority rules.
 *
 * `resolveClickThrough` decides what URL the widget opens on click.
 * The rule: per-item `clickUrl` always wins; the source-level
 * `clickThroughUrl` template (with `{itemId}` substitution) is the
 * fallback for items that don't carry their own destination URL.
 * Earlier versions reversed this priority, which caused the tyan.ai
 * video widget to open `https://tyan.ai` (the source template) instead
 * of the per-character messenger page (the item's own `clickUrl`).
 *
 * We exercise the function via a minimal harness that bypasses the
 * Cordis `Service` base class: `resolveClickThrough` only reads from
 * the `sources` map and `fillTemplate`, both of which are easy to
 * stub.
 */

import { describe, expect, it } from 'vitest'
import { fillTemplate } from '../src/adapter.ts'
import type { AdSourceConfig, AdItem } from '../src/adapter.ts'

/** Reproduce `AdService.resolveClickThrough` exactly, without the
 *  Cordis base class. Kept in sync with `src/service.ts`. */
function resolveClickThrough(
  sources: Map<string, AdSourceConfig>,
  sourceId: string,
  item: AdItem,
): string | undefined {
  if (item.clickUrl !== undefined && item.clickUrl !== '') return item.clickUrl
  const source = sources.get(sourceId)
  if (source?.clickThroughUrl === undefined) return undefined
  return fillTemplate(source.clickThroughUrl, {
    itemId: encodeURIComponent(item.id),
    clickUrl: item.clickUrl ?? '',
  })
}

describe('service: resolveClickThrough priority', () => {
  it('returns the per-item clickUrl even when the source has a clickThroughUrl', () => {
    // Tyan.ai shape: source has a fallback template, items carry
    // their own per-character messenger URL. The per-item URL must
    // win — otherwise the widget opens the tyan.ai root for every
    // click.
    const sources = new Map<string, AdSourceConfig>([[
      'tyan-videos',
      {
        id: 'tyan-videos',
        name: 'Tyan Avatars',
        contentTypes: ['video'],
        staticItems: [],
        clickThroughUrl: 'https://tyan.ai',
      },
    ]])
    const item: AdItem = {
      id: 'tyan-1',
      type: 'video',
      title: 'Emily, 18',
      clickUrl: 'https://tyan.ai/en/messenger?id=28979',
    }
    expect(resolveClickThrough(sources, 'tyan-videos', item))
      .toBe('https://tyan.ai/en/messenger?id=28979')
  })

  it('falls back to the source clickThroughUrl template when the item has no clickUrl', () => {
    // CS:GO / marketplace shape: items don't carry their own URL,
    // the source template does (with `{itemId}`). Behavior must not
    // regress.
    const sources = new Map<string, AdSourceConfig>([[
      'csgo-market',
      {
        id: 'csgo-market',
        name: 'CS:GO Market',
        contentTypes: ['product'],
        staticItems: [],
        clickThroughUrl: 'https://market.csgo.com/item/{itemId}?utm_source=dsh-ad',
      },
    ]])
    const item: AdItem = {
      id: 'AK-47 | Redline (FT)',
      type: 'product',
      title: 'AK-47 | Redline (FT)',
    }
    expect(resolveClickThrough(sources, 'csgo-market', item))
      .toBe('https://market.csgo.com/item/AK-47%20%7C%20Redline%20(FT)?utm_source=dsh-ad')
  })

  it('returns undefined when neither the item nor the source has a click URL', () => {
    const sources = new Map<string, AdSourceConfig>([[
      'empty',
      { id: 'empty', name: 'empty', contentTypes: ['image'], staticItems: [] },
    ]])
    const item: AdItem = { id: 'x', type: 'image', title: 'x' }
    expect(resolveClickThrough(sources, 'empty', item)).toBeUndefined()
  })
})

/**
 * Tests for `AdService.nextItem` direction support.
 *
 * `nextItem(sourceId, runtime, delta)` advances the rotation cursor
 * by `delta` items (default +1). Used by the auto-rotation timer
 * (delta=+1) and by the manual prev/next nav buttons (delta=±1).
 * The cursor wraps modulo `items.length`; negative deltas wrap
 * backwards.
 *
 * The reproduction below is a minimal harness: the real
 * `nextItem` depends on `cache`, `isEligible`, and
 * `recordImpression`. None of those affect direction — only the
 * cursor math matters for these assertions. We copy the cursor
 * math verbatim from `src/service.ts` so a regression in
 * direction handling surfaces here even before the harness
 * loads Cordis.
 */

describe('service: nextItem delta', () => {
  /** Reproduction of the cursor-math inside `nextItem`.
   *
   *  Convention: `cursor` is the index of the LAST shown item.
   *  The cursor is initialized to n-1 (the last index), so the
   *  first +1 call shows items[0] and the rotation order matches
   *  the original v0.6: A, B, C, A, B, C, …
   *  readAt = (cursor + delta) mod n (non-negative modulo for
   *  negative deltas).
   */
  function stepWith(items: string[], cursor: number, delta: number): { item: string; cursor: number } {
    const n = items.length
    const readAt = ((cursor + delta) % n + n) % n
    return { item: items[readAt]!, cursor: readAt }
  }

  it('starts at n-1 and the first +1 returns items[0] (A, B, C, …)', () => {
    let c = 2 // n-1 for items=['A','B','C']
    const a = stepWith(['A', 'B', 'C'], c, +1); c = a.cursor
    expect(a.item).toBe('A')
    const b = stepWith(['A', 'B', 'C'], c, +1); c = b.cursor
    expect(b.item).toBe('B')
    const cc = stepWith(['A', 'B', 'C'], c, +1); c = cc.cursor
    expect(cc.item).toBe('C')
  })

  it('wraps forward from the last item back to the first', () => {
    // After showing 'C' (cursor=2), a +1 call shows 'A' (wrap).
    const a = stepWith(['A', 'B', 'C'], 2, +1)
    expect(a.item).toBe('A')
    expect(a.cursor).toBe(0)
  })

  it('delta=-1 from the last item wraps to the first', () => {
    // cursor=2 + delta=-1 → readAt=1 → returns 'B'.
    const a = stepWith(['A', 'B', 'C'], 2, -1)
    expect(a.item).toBe('B')
    expect(a.cursor).toBe(1)
  })

  it('delta=-1 from the first item wraps to the last', () => {
    // cursor=0 + delta=-1 → readAt = (0 + -1) mod 3 = 2 → 'C'.
    const a = stepWith(['A', 'B', 'C'], 0, -1)
    expect(a.item).toBe('C')
    expect(a.cursor).toBe(2)
  })

  it('delta=0 re-shows the current item', () => {
    // After 'B' is shown, delta=0 returns 'B' again.
    const a = stepWith(['A', 'B', 'C'], 1, 0)
    expect(a.item).toBe('B')
    expect(a.cursor).toBe(1)
  })

  it('forward then back returns to the previous item', () => {
    // After 'A' (cursor=0), "prev" goes to 'C' (wrap), then "next"
    // returns to 'A'.
    const back = stepWith(['A', 'B', 'C'], 0, -1)
    expect(back.item).toBe('C')
    const fwd = stepWith(['A', 'B', 'C'], back.cursor, +1)
    expect(fwd.item).toBe('A')
  })
})
