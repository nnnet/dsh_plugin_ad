/**
 * Client-side constants. Only paths and the widget rotation interval;
 * everything else (numeric caps, content types) is shared with the host
 * via the typed contracts in `types.ts`. Keep this file tiny — most
 * defaults are pulled from the host response (`/api/ad/sources`).
 * @module dsh_plugin_ad/client/constants
 */

import { DEFAULT_DISPLAY_MS } from '../display-time.ts'

/** Mirror of the host `API_PREFIX`. The host and client must agree. */
export const API_PREFIX = '/api/ad'

/**
 * How often the widget polls `/api/ad/next` to rotate creatives.
 * Re-exported from the shared `display-time` module so server and
 * client agree on a single default. The widget's actual timeout
 * chain reads from each item's `displayMs` field first; this
 * constant is the fallback when the host doesn't set anything.
 */
export const WIDGET_ROTATION_MS = DEFAULT_DISPLAY_MS

/**
 * How often the widget re-reads the host's display/enabled/activeSourceId
 * so a settings change in the AdSettingsCard (OFF/ON, source switch,
 * position drag) takes effect within a few seconds. This is the
 * cross-fiber pull-bridge the standalone plugin uses in place of an
 * in-process settings-scope subscription. 2s keeps the OFF/ON
 * reaction feeling instant without burning RPCs.
 */
export const DISPLAY_POLL_MS = 2_000

/** Cap for arbitrary JSON request bodies the widget sends. */
export const JSON_BODY_MAX_BYTES = 64 * 1024
