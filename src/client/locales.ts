/**
 * Client-facing re-export of the shared locale dictionary. Kept as its own
 * module (mirroring dsh-pet's `client/locales.ts`) so client components
 * import from a stable relative path even if the shared module later moves.
 * @module @linxin666/dsh-ad/client/locales
 */
export { NS, en, zh, t, dictionary } from '../locales/index.ts'
export type { AdKey } from '../locales/index.ts'
