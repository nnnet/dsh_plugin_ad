/**
 * dsh-ad locale dictionaries (en/zh) — the single source of truth for every
 * user-facing string in this plugin, host and client alike. No component
 * should inline a display string; add a key here (in both languages) and
 * reference it through `t()`/`dictionary()` instead. This mirrors the
 * dsh-pet locale module pattern so the same settings/i18n plumbing applies.
 * @module @linxin666/dsh-ad/locales
 */

import { en } from './en.ts'
import { zh } from './zh.ts'

/** Dictionary namespace this package registers. */
export const NS = 'ad'

export { en, zh }

/** Key union derived from the English dictionary (both dictionaries must match). */
export type AdKey = keyof typeof en

/**
 * Active dictionary, picked by the document language at call time. Falls
 * back to English for any language that isn't Chinese, matching the
 * two-locale scope of this plugin today; add more `else if` branches here
 * (and a matching `./xx.ts` file) to extend coverage.
 */
export function dictionary(): Record<AdKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'en'
  return lang.toLowerCase().startsWith('zh') ? zh : en
}

/**
 * Translate a key with optional `{name}` template params. A missing key
 * degrades to the key itself rather than throwing, so a partially-translated
 * rollout never breaks the UI.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  let text: string = (dictionary() as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-ad UI copy. */
    ad: AdKey
  }
}
