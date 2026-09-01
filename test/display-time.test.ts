/**
 * Unit tests for `clampDurationMs` — the shared helper that turns a
 * raw `<video>.duration` (seconds, often `NaN` until metadata loads)
 * into the millisecond rotation timeout the widget will actually use.
 *
 * The helper lives in `src/display-time.ts` and is consumed by both:
 *   - the browser (in `loadedmetadata`, where we re-derive the
 *     effective rotation timeout from the real clip length), and
 *   - the host's test/build path (only via the type contract — the
 *     server doesn't read video metadata, so this is the canonical
 *     client-side rule; the server uses the source's `displayMs`).
 *
 * Behavior contract:
 *   - `null` is returned for any non-finite, zero, or negative input.
 *     Callers MUST fall back to the source's `displayMs` when the
 *     helper returns null — a 0-duration or `NaN` clip is treated as
 *     "metadata not yet usable" rather than "rotate immediately".
 *   - The returned number is always within [minMs, maxMs].
 *   - The input is treated as milliseconds (NOT seconds). The browser
 *     caller does `duration * 1000` BEFORE handing the value in.
 */

import { describe, expect, it } from 'vitest'
import { clampDurationMs } from '../src/display-time.ts'

describe('display-time.clampDurationMs', () => {
  it('returns the value verbatim when it is inside the band', () => {
    expect(clampDurationMs(7_000, 4_000, 120_000)).toBe(7_000)
  })

  it('clamps a value below the minimum', () => {
    expect(clampDurationMs(2_000, 4_000, 120_000)).toBe(4_000)
  })

  it('clamps a value above the maximum', () => {
    expect(clampDurationMs(200_000, 4_000, 120_000)).toBe(120_000)
  })

  it('returns null for NaN (metadata not yet available)', () => {
    expect(clampDurationMs(Number.NaN, 4_000, 120_000)).toBeNull()
  })

  it('returns null for Infinity (impossible but defensive)', () => {
    expect(clampDurationMs(Number.POSITIVE_INFINITY, 4_000, 120_000)).toBeNull()
  })

  it('returns null for negative Infinity', () => {
    expect(clampDurationMs(Number.NEGATIVE_INFINITY, 4_000, 120_000)).toBeNull()
  })

  it('returns null for a zero duration (treated as missing metadata)', () => {
    // A 0-ms clip would mean "rotate immediately" — a UX disaster. We
    // surface that as missing metadata and let the caller fall back
    // to the source's `displayMs` instead.
    expect(clampDurationMs(0, 4_000, 120_000)).toBeNull()
  })

  it('returns null for a negative duration (defensive)', () => {
    expect(clampDurationMs(-5_000, 4_000, 120_000)).toBeNull()
  })

  it('returns the minimum when duration equals minimum', () => {
    expect(clampDurationMs(4_000, 4_000, 120_000)).toBe(4_000)
  })

  it('returns the maximum when duration equals maximum', () => {
    expect(clampDurationMs(120_000, 4_000, 120_000)).toBe(120_000)
  })

  it('returns null when min is greater than max (caller error)', () => {
    // Defensive: the host should reject inverted bounds at config
    // validation time, but if a runtime bug ever passes them through,
    // the helper should not produce nonsense.
    expect(clampDurationMs(7_000, 10_000, 5_000)).toBeNull()
  })
})
