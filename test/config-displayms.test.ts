/**
 * Unit tests for the new `displayMs` / `minVideoMs` / `maxVideoMs`
 * fields on `AdSourceConfig` — the per-source rotation timing knob
 * added by `feat-resize-and-display-ms`.
 *
 * Validation rules (mirrored from the OpenSpec change):
 *   - All three fields are optional. Omitted → documented default.
 *     Defaults: `displayMs = 15_000`, `minVideoMs = 4_000`,
 *     `maxVideoMs = 120_000`.
 *   - `displayMs` must be in [1_000, 600_000]. Out-of-range → the
 *     loader throws with the source id + offending value in the
 *     message.
 *   - `minVideoMs` / `maxVideoMs` must each be in [100, 600_000],
 *     and `minVideoMs <= maxVideoMs`. Inverted bounds → loader throws.
 *
 * The host's config loader is the only place that needs to enforce
 * these rules, so the validation lives in `resolveDisplayMs` in
 * `src/display-time.ts` rather than the schemastery schema (which
 * has its own quirks around optional fields and the existing source
 * contract). This test file exercises `resolveDisplayMs` directly.
 */

import { describe, expect, it } from 'vitest'
import { resolveDisplayMs, type ResolvedDisplayTime } from '../src/display-time.ts'
import type { AdSourceConfig } from '../src/config.ts'

/** Cast through unknown so we can build a minimal stub source. */
function source(overrides: Partial<AdSourceConfig> = {}): AdSourceConfig {
  return {
    id: 'sample',
    name: 'Sample',
    contentTypes: ['image'],
    ...overrides,
  } as AdSourceConfig
}

describe('config: displayMs / minVideoMs / maxVideoMs defaults', () => {
  it('uses the documented defaults when the fields are omitted', () => {
    const result: ResolvedDisplayTime = resolveDisplayMs(source())
    expect(result.displayMs).toBe(15_000)
    expect(result.minVideoMs).toBe(4_000)
    expect(result.maxVideoMs).toBe(120_000)
  })

  it('accepts a valid displayMs override', () => {
    const result = resolveDisplayMs(source({ displayMs: 5_000 }))
    expect(result.displayMs).toBe(5_000)
  })

  it('accepts a custom min/max pair', () => {
    const result = resolveDisplayMs(source({ minVideoMs: 8_000, maxVideoMs: 30_000 }))
    expect(result.minVideoMs).toBe(8_000)
    expect(result.maxVideoMs).toBe(30_000)
  })

  it('coerces string numbers (config file ergonomic)', () => {
    // YAML lets users write `displayMs: "5000"` without quotes; the
    // resolver should treat that as 5000 rather than rejecting it.
    const result = resolveDisplayMs(source({
      displayMs: '5000' as unknown as number,
      minVideoMs: '4000' as unknown as number,
      maxVideoMs: '120000' as unknown as number,
    }))
    expect(result.displayMs).toBe(5_000)
    expect(result.minVideoMs).toBe(4_000)
    expect(result.maxVideoMs).toBe(120_000)
  })
})

describe('config: displayMs bounds', () => {
  it('rejects displayMs below the lower bound (500)', () => {
    expect(() => resolveDisplayMs(source({ id: 'x', displayMs: 500 })))
      .toThrow(/displayMs/i)
  })

  it('rejects displayMs above the upper bound (700_000)', () => {
    expect(() => resolveDisplayMs(source({ displayMs: 700_000 })))
      .toThrow(/displayMs/i)
  })

  it('accepts the lower bound (1_000)', () => {
    const result = resolveDisplayMs(source({ displayMs: 1_000 }))
    expect(result.displayMs).toBe(1_000)
  })

  it('accepts the upper bound (600_000)', () => {
    const result = resolveDisplayMs(source({ displayMs: 600_000 }))
    expect(result.displayMs).toBe(600_000)
  })

  it('the error message names the offending source id', () => {
    expect(() => resolveDisplayMs(source({ id: 'bad-tyan', displayMs: 500 })))
      .toThrow(/bad-tyan/)
  })

  it('the error message includes the offending value', () => {
    expect(() => resolveDisplayMs(source({ id: 'bad-tyan', displayMs: 500 })))
      .toThrow(/500/)
  })

  it('rejects non-finite values (NaN, Infinity)', () => {
    expect(() => resolveDisplayMs(source({ displayMs: Number.NaN })))
      .toThrow(/displayMs/i)
    expect(() => resolveDisplayMs(source({ displayMs: Number.POSITIVE_INFINITY })))
      .toThrow(/displayMs/i)
  })
})

describe('config: minVideoMs / maxVideoMs bounds', () => {
  it('rejects inverted min/max (min greater than max)', () => {
    expect(() => resolveDisplayMs(source({ minVideoMs: 10_000, maxVideoMs: 5_000 })))
      .toThrow(/minVideoMs.*maxVideoMs|maxVideoMs.*minVideoMs/i)
  })

  it('accepts equal min and max (degenerate but valid)', () => {
    const result = resolveDisplayMs(source({ minVideoMs: 7_000, maxVideoMs: 7_000 }))
    expect(result.minVideoMs).toBe(7_000)
    expect(result.maxVideoMs).toBe(7_000)
  })

  it('rejects minVideoMs below its lower bound (50)', () => {
    expect(() => resolveDisplayMs(source({ minVideoMs: 50 })))
      .toThrow(/minVideoMs/i)
  })

  it('rejects maxVideoMs above its upper bound (700_000)', () => {
    expect(() => resolveDisplayMs(source({ maxVideoMs: 700_000 })))
      .toThrow(/maxVideoMs/i)
  })
})
