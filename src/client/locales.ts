/**
 * dsh-ad client — locale dictionary. Carries the much larger set of UI
 * keys the widget renders (product card, chat panel, cart drawer, ...).
 * Host-side copy lives in `../locales/`. The active dictionary is selected
 * by `document.documentElement.lang` at call time, with a `zh*` -> Chinese
 * branch and everything else falling back to English.
 * @module dsh_plugin_ad/client/locales
 */

import { en } from './locales/en.ts'
import { zh } from './locales/zh.ts'

/** Dictionary namespace this package registers. */
export const NS = 'ad'

export { en, zh }

/** Key union derived from the English dictionary (both must match). */
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
