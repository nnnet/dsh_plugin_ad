/**
 * Host-side locale dictionaries (en/zh) for dsh-ad. This is the *host*
 * namespace: settings page copy, source diagnostics, and content-type
 * labels. The browser widget has its own richer dictionary under
 * `src/client/locales.ts` because the widget needs far more keys (product
 * card, chat panel, cart drawer, ...).
 *
 * The same active-locale selection rule (Chinese when document lang starts
 * with `zh`, else English) is used on both sides so the widget and the
 * settings page stay in lockstep.
 * @module dsh_plugin_ad/locales
 */

import { en } from './en.ts'
import { zh } from './zh.ts'

/** Dictionary namespace this package registers. */
export const NS = 'ad'

export { en, zh }

/** Key union derived from the English dictionary; both dictionaries must match. */
export type AdHostKey = keyof typeof en

/**
 * Active host dictionary, picked by the document language at call time. A
 * non-`zh*` language falls back to English (matches the two-locale scope of
 * this plugin today). Extend with more `else if` branches and a matching
 * `./xx.ts` file to add coverage.
 */
export function dictionary(): Record<AdHostKey, string> {
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
