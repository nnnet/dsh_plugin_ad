import { en } from "./en.js";
import { zh } from "./zh.js";
export const NS = 'adPet';
export { en, zh };
export function dictionary(lang) {
    const value = lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'en');
    return value.toLowerCase().startsWith('zh') ? zh : en;
}
export function t(key, params, lang) {
    let text = dictionary(lang)[key] ?? key;
    for (const [name, value] of Object.entries(params ?? {}))
        text = text.replaceAll(`{${name}}`, String(value));
    return text;
}
