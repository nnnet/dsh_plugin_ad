/**
 * dsh-ad — display-time helpers shared between the host and the
 * browser. Kept in `src/` (not `src/client/`) so the same module
 * can be imported by both halves; the runtime types it returns are
 * plain numbers with no DOM dependency.
 *
 * The motivating use case is video creatives: a 5-second clip should
 * not be followed by ten seconds of dead air, and a 90-second
 * product video should not be cut off mid-engagement. The widget
 * reads `<video>.duration` once `loadedmetadata` fires and re-derives
 * the rotation timeout from the clip's real length. This module
 * owns:
 *
 *   1. The bounds + defaults for the per-source `displayMs` knob
 *      (used by `resolveDisplayMs`, the config loader's contract
 *      enforcer).
 *   2. The "is this video duration usable, and within the source's
 *      bounds" decision (`clampDurationMs`, consumed on the
 *      browser's `loadedmetadata` event).
 *
 * @module dsh_plugin_ad/display-time
 */

/**
 * Default per-source rotation interval (ms) when the source omits
 * `displayMs`. Mirrors the client-side `WIDGET_ROTATION_MS`; the
 * values are kept in sync deliberately (one user-facing knob, one
 * default).
 */
export const DEFAULT_DISPLAY_MS = 15_000

/** Default lower clamp (ms) for video items: minimum time on screen. */
export const DEFAULT_MIN_VIDEO_MS = 4_000

/** Default upper clamp (ms) for video items: maximum time on screen. */
export const DEFAULT_MAX_VIDEO_MS = 120_000

/** Absolute bounds enforced by the resolver. The OpenSpec anchors
 *  these in `displayMs: 1000..600000` and
 *  `minVideoMs/maxVideoMs: 100..600000`. */
export const MIN_DISPLAY_MS = 1_000
export const MAX_DISPLAY_MS = 600_000
export const MIN_VIDEO_MS = 100
export const MAX_VIDEO_MS = 600_000

/** Resolved timing for a single source, with defaults applied. */
export interface ResolvedDisplayTime {
  displayMs: number
  minVideoMs: number
  maxVideoMs: number
}

/**
 * Turn a raw video duration (already in milliseconds — the browser
 * caller does `duration * 1000` before calling) into the rotation
 * timeout the widget will actually use. Returns `null` when the
 * input is unusable (NaN, Infinity, zero, negative, or otherwise
 * non-finite), letting the caller fall back to the source's
 * `displayMs` default instead of rotating "immediately" on a
 * zero-length clip.
 *
 * @param durationMs Raw duration in milliseconds.
 * @param minMs Source's `minVideoMs` (default 4 000).
 * @param maxMs Source's `maxVideoMs` (default 120 000).
 * @returns The clamped timeout in ms, or `null` if the input is
 *          unusable. Callers MUST fall back to `displayMs` on null.
 */
export function clampDurationMs(
  durationMs: number,
  minMs: number,
  maxMs: number,
): number | null {
  if (!Number.isFinite(durationMs)) return null
  if (durationMs <= 0) return null
  // Defensive: a misconfigured source might pass inverted bounds.
  // Surfacing null keeps the caller on its `displayMs` fallback path
  // rather than emitting a nonsense value.
  if (minMs > maxMs) return null
  if (durationMs < minMs) return minMs
  if (durationMs > maxMs) return maxMs
  return durationMs
}

/**
 * Resolve the per-source timing triple for a configured source.
 * Applies the documented defaults and validates the bounds; throws
 * a descriptive `Error` (naming the source id and offending value)
 * when the source declares an out-of-range or inverted value.
 *
 * This is the host config loader's contract enforcer. The
 * schemastery `adSourceSchema` in `src/config.ts` also documents
 * the same fields, but its full-source validation is awkward to
 * run from tests (it depends on a dozen other required fields
 * unrelated to display timing), so we keep the per-field rules
 * here and the loader calls us in addition to the schema pass.
 *
 * @param source A configured ad source (or a partial one — only
 *               `id`, `displayMs`, `minVideoMs`, `maxVideoMs` are
 *               read).
 * @returns The resolved timing triple with defaults filled in.
 */
export function resolveDisplayTime(source: {
  id?: string
  displayMs?: number | string
  minVideoMs?: number | string
  maxVideoMs?: number | string
}): ResolvedDisplayTime {
  const id = source.id ?? '<unknown>'
  const displayMs = coerceMs(source.displayMs, DEFAULT_DISPLAY_MS, id, 'displayMs')
  const minVideoMs = coerceMs(source.minVideoMs, DEFAULT_MIN_VIDEO_MS, id, 'minVideoMs')
  const maxVideoMs = coerceMs(source.maxVideoMs, DEFAULT_MAX_VIDEO_MS, id, 'maxVideoMs')
  if (minVideoMs > maxVideoMs) {
    throw new Error(
      `[dsh-ad] source '${id}': minVideoMs (${minVideoMs}) cannot exceed maxVideoMs (${maxVideoMs})`,
    )
  }
  return { displayMs, minVideoMs, maxVideoMs }
}

/** Coerce a number-or-string config value into the documented
 *  bound, throwing with the source id and offending value when the
 *  value is non-finite or out of range. The function picks the
 *  bound set based on the field name (displayMs vs. min/maxVideoMs)
 *  so the error message and bounds differ per field. */
function coerceMs(
  raw: unknown,
  fallback: number,
  sourceId: string,
  field: 'displayMs' | 'minVideoMs' | 'maxVideoMs',
): number {
  if (raw === undefined || raw === null) return fallback
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`[dsh-ad] source '${sourceId}': ${field} must be a finite number, got ${String(raw)}`)
  }
  const [min, max] = field === 'displayMs'
    ? [MIN_DISPLAY_MS, MAX_DISPLAY_MS]
    : [MIN_VIDEO_MS, MAX_VIDEO_MS]
  if (value < min || value > max) {
    throw new Error(`[dsh-ad] source '${sourceId}': ${field}=${value} is out of range [${min}, ${max}]`)
  }
  return value
}

/** Convenience re-export matching the function name used in
 *  `test/config-displayms.test.ts`. Same signature. */
export const resolveDisplayMs = resolveDisplayTime

/** Read the per-item rotation timeout in ms. The order of precedence
 *  is the one the OpenSpec change locks in:
 *
 *    1. Server-computed `displayMs` for the current item (per-source
 *       knob, refined by the browser on `loadedmetadata` for video).
 *    2. `display.rotationMs` from the host settings card (per-deployment
 *       fallback when the source omits `displayMs`).
 *    3. `WIDGET_ROTATION_MS` (15 000 ms) — the client default.
 *
 *  Each step is checked for "is it a finite positive number"; a
 *  malformed override is treated as absent and the next step wins.
 *  This is the same precedence the widget's `setTimeout` chain uses.
 *
 *  @param item `displayMs` from the most recent `/api/ad/next` response.
 *  @param displayRotationMs The host's `display.rotationMs` setting
 *                            (from `AdSettingsCard` / settings store).
 *  @param defaultMs The client-side constant — the last-resort fallback.
 */
export function pickRotationMs(
  item: { displayMs?: number | undefined } | null | undefined,
  displayRotationMs: number | undefined,
  defaultMs: number,
): number {
  const candidates: Array<number | undefined> = [
    item?.displayMs,
    displayRotationMs,
    defaultMs,
  ]
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return defaultMs
}
