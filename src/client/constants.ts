/**
 * Client-side constants. Only paths and the widget rotation interval;
 * everything else (numeric caps, content types) is shared with the host
 * via the typed contracts in `types.ts`. Keep this file tiny — most
 * defaults are pulled from the host response (`/api/ad/sources`).
 * @module dsh_plugin_ad/client/constants
 */

/** Mirror of the host `API_PREFIX`. The host and client must agree. */
export const API_PREFIX = '/api/ad'

/** How often the widget polls `/api/ad/next` to rotate creatives. */
export const WIDGET_ROTATION_MS = 15_000

/** Cap for arbitrary JSON request bodies the widget sends. */
export const JSON_BODY_MAX_BYTES = 64 * 1024
