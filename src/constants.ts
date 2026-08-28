/** Non-user-facing constants only. All UI copy lives in src/locales/*.ts. */
export const PLUGIN_NAME = 'ad-pet'
export const SETTINGS_NAMESPACE = 'adPet'
export const API_PREFIX = '/api/ad-pet'
export const MEDIA_PREFIX = `${API_PREFIX}/media`
export const DEFAULT_POLL_MS = 60_000
export const MIN_POLL_MS = 5_000
export const MAX_POLL_MS = 86_400_000
export const REQUEST_TIMEOUT_MS = 15_000
export const MAX_JSON_BYTES = 2 * 1024 * 1024
export const MAX_MEDIA_BYTES = 32 * 1024 * 1024
export const MAX_CHAT_BYTES = 256 * 1024
export const MAX_STREAM_SECONDS = 120
export const MAX_ITEMS = 50
