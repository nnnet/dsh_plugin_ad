import { en } from './en.ts'
import { zh } from './zh.ts'
export const NS = 'adPet'
export { en, zh }
export type LocaleKey = keyof typeof en
export function dictionary(lang?: string): Record<LocaleKey, string> {
  const value = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'en')
  return value.toLowerCase().startsWith('zh') ? zh : en
}
export function t(key: string, params?: Record<string, unknown>, lang?: string): string {
  let text = dictionary(lang)[key as LocaleKey] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { adPet: LocaleKey }
}
