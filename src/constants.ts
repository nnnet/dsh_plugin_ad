/**
 * dsh-ad — non-user-facing constants. Every numeric/path/prefix value that
 * isn't user copy lives here so the runtime values can be referenced,
 * overridden, and unit-tested from a single place. UI strings are kept in
 * `src/locales/*.ts`; diagnostic / error strings in `src/messages.ts`.
 * @module dsh_plugin_ad/constants
 */

/** Stable cordis plugin name (matches `package.json#name`). */
export const PLUGIN_NAME = 'dsh_plugin_ad'

/** Cordis short name (the value `name` exported from index.ts). */
export const CORDIS_NAME = 'ad'

/** Settings section namespace; the host `installSettingsSection` key. */
export const SETTINGS_NAMESPACE = 'ad'

/** Browser-facing base path for the ad plugin's JSON API. */
export const API_PREFIX = '/api/ad'

/** Default feed poll interval (ms). Used when a source omits `pollIntervalMs`. */
export const DEFAULT_POLL_MS = 60_000

/** Minimum allowed poll interval (ms). Schemastery enforces this too. */
export const MIN_POLL_MS = 2_000

/** Maximum allowed poll interval (ms). */
export const MAX_POLL_MS = 3_600_000

/** Default per-call HTTP timeout for the feed (ms). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000

/** Default per-call HTTP timeout for the chat (ms). */
export const DEFAULT_CHAT_TIMEOUT_MS = 30_000

/** Min allowed per-call HTTP timeout (ms). */
export const MIN_REQUEST_TIMEOUT_MS = 500

/** Max allowed per-call HTTP timeout (ms). */
export const MAX_REQUEST_TIMEOUT_MS = 60_000

/** Cap for arbitrary JSON request bodies (cart / refresh / chat payloads). */
export const JSON_BODY_MAX_BYTES = 64 * 1024

/** Cap for a single streamed response (text or SSE). */
export const STREAM_MAX_BYTES = 8 * 1024 * 1024

/** Default rotation interval for the widget's "next ad" poll (ms). */
export const WIDGET_ROTATION_MS = 15_000

/** Default max items the widget will keep per source cache. */
export const MAX_FEED_ITEMS = 50

/** Max number of cart lines the widget will display. */
export const MAX_CART_LINES = 100

/** Max number of chat history turns sent per call. */
export const MAX_HISTORY_TURNS = 50

/** Default content-type list a source is expected to support when omitted. */
export const DEFAULT_CONTENT_TYPES = ['image'] as const

/** All known content types (must stay in sync with config.ts's AdContentType). */
export const ALL_CONTENT_TYPES = ['video', 'gif', 'image', 'text', 'message', 'chat', 'html', 'card', 'raw', 'product'] as const
