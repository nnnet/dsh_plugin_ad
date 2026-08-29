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

/**
 * Default per-source `maxItems` cap on how many normalized items the host
 * keeps in rotation. Overridable via `source.maxItems`; raised from 50 →
 * 500 in v0.7 so the user sees more than "a few" items from large feeds
 * like CS:GO Market (~10k items).
 */
export const DEFAULT_MAX_ITEMS = 500

/**
 * Global hard ceiling on `source.maxItems` — anything larger is clamped.
 * Raised to 5_000 to accommodate dense feeds without holding tens of MB
 * of normalized items in memory; sources that need more should split
 * their payload server-side.
 */
export const MAX_FEED_ITEMS = 5_000

/** Default widget display size (px) — Pet-style `size` field. */
export const DEFAULT_WIDGET_SIZE = 360

/** Default widget horizontal/vertical inset (px) — Pet-style `right`/`bottom`. */
export const DEFAULT_WIDGET_INSET = 24

/** Bounds for the `right`/`bottom` slider in the settings card. */
export const MIN_WIDGET_INSET = 0
export const MAX_WIDGET_INSET = 200

/** Bounds for the widget `size` slider. */
export const MIN_WIDGET_SIZE = 200
export const MAX_WIDGET_SIZE = 800

/** Max number of cart lines the widget will display. */
export const MAX_CART_LINES = 100

/** Max number of chat history turns sent per call. */
export const MAX_HISTORY_TURNS = 50

/** Default content-type list a source is expected to support when omitted. */
export const DEFAULT_CONTENT_TYPES = ['image'] as const

/** All known content types (must stay in sync with config.ts's AdContentType). */
export const ALL_CONTENT_TYPES = ['video', 'gif', 'image', 'text', 'message', 'chat', 'html', 'card', 'raw', 'product'] as const
