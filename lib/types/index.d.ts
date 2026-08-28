import { Context } from '@deepseek-ai/cordis';
import { type AdPetConfig } from './config.ts';
export { AdPetService } from './service.ts';
export type { AdContentType, AdEventType, AdItem, AdSnapshot, AdTargetingContext } from './service.ts';
export type { AdActionConfig, AdMappingConfig, AdPetConfig, AdRequestConfig, AdSourceAuth, AdSourceConfig, JsonValue, ResolvedAdPetConfig, SecretValue, } from './config.ts';
export { resolveConfig, getPath, renderTemplate, secret } from './config.ts';
export { API_PREFIX, MEDIA_PREFIX } from './constants.ts';
export declare const name = "ad-pet";
export declare const inject: string[];
export declare const apply: typeof applyImpl;
declare function applyImpl(ctx: Context, config?: AdPetConfig): void;
//# sourceMappingURL=index.d.ts.map