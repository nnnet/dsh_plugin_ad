import { en } from './en.ts';
import { zh } from './zh.ts';
export declare const NS = "adPet";
export { en, zh };
export type LocaleKey = keyof typeof en;
export declare function dictionary(lang?: string): Record<LocaleKey, string>;
export declare function t(key: string, params?: Record<string, unknown>, lang?: string): string;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        adPet: LocaleKey;
    }
}
//# sourceMappingURL=index.d.ts.map