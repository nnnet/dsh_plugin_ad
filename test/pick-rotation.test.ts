/**
 * Unit tests for the rotation-timeout precedence rule.
 *
 * The widget's auto-rotation timer is a `setTimeout` chain whose
 * next-fire delay is computed on every item change. The rule is
 * defined by the OpenSpec change as:
 *
 *   1. item.displayMs (server-computed for the just-returned item)
 *   2. display.rotationMs (host settings-card override)
 *   3. WIDGET_ROTATION_MS (15 000 ms, the client default)
 *
 * Malformed values (NaN, negative, non-finite) MUST be treated as
 * absent so a single bad override doesn't freeze the widget on a
 * 0-ms or year-long interval.
 */

import { describe, expect, it } from 'vitest'
import { pickRotationMs } from '../src/display-time.ts'

const DEFAULT_MS = 15_000

describe('widget rotation: pickRotationMs precedence', () => {
  it('item.displayMs wins over the host override', () => {
    expect(pickRotationMs({ displayMs: 5_000 }, 30_000, DEFAULT_MS)).toBe(5_000)
  })

  it('host settings override wins when item omits displayMs', () => {
    expect(pickRotationMs({}, 30_000, DEFAULT_MS)).toBe(30_000)
  })

  it('client default applies when neither override is set', () => {
    expect(pickRotationMs({}, undefined, DEFAULT_MS)).toBe(DEFAULT_MS)
  })

  it('item.displayMs=0 is treated as absent (rotate-immediately is a UX disaster)', () => {
    expect(pickRotationMs({ displayMs: 0 }, 30_000, DEFAULT_MS)).toBe(30_000)
  })

  it('item.displayMs=NaN is treated as absent', () => {
    expect(pickRotationMs({ displayMs: Number.NaN }, 30_000, DEFAULT_MS)).toBe(30_000)
  })

  it('item.displayMs=Infinity is treated as absent', () => {
    expect(pickRotationMs({ displayMs: Number.POSITIVE_INFINITY }, 30_000, DEFAULT_MS)).toBe(30_000)
  })

  it('item.displayMs=-1 is treated as absent', () => {
    expect(pickRotationMs({ displayMs: -1 }, 30_000, DEFAULT_MS)).toBe(30_000)
  })

  it('null item is treated as absent', () => {
    expect(pickRotationMs(null, 30_000, DEFAULT_MS)).toBe(30_000)
  })

  it('host override=0 is treated as absent (let the default apply)', () => {
    expect(pickRotationMs({}, 0, DEFAULT_MS)).toBe(DEFAULT_MS)
  })

  it('a 7 s video source with default minVideoMs=4000 produces a 7 s timer', () => {
    // The full pipeline: server returns `displayMs: 7000` (the source
    // default). The browser refines to the actual video duration on
    // `loadedmetadata`; until then the timer fires after 7 s.
    expect(pickRotationMs({ displayMs: 7_000 }, undefined, DEFAULT_MS)).toBe(7_000)
  })

  it('a 90 s video with maxVideoMs=60_000 produces a 60 s timer', () => {
    // The browser does the `clamp(90_000, 4_000, 60_000) = 60_000` and
    // re-derives the timer via `item.displayMs = 60_000`.
    expect(pickRotationMs({ displayMs: 60_000 }, undefined, DEFAULT_MS)).toBe(60_000)
  })
})
