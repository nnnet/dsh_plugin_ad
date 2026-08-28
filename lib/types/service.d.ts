import type { Context } from '@deepseek-ai/cordis';
import type { AdSourceConfig, ResolvedAdPetConfig } from './config.ts';
export type AdContentType = 'text' | 'image' | 'gif' | 'video' | 'message' | 'card' | 'html' | 'raw';
export type AdEventType = 'impression' | 'click' | 'conversion';
export interface AdItem {
    id: string;
    type: AdContentType;
    title?: string;
    text?: string;
    description?: string;
    image?: string;
    media?: string;
    url?: string;
    assistantId?: string;
    productId?: string;
    sku?: string;
    price?: string | number;
    originalPrice?: string | number;
    currency?: string;
    discount?: string | number;
    brand?: string;
    rating?: string | number;
    badge?: string;
    gallery?: string[];
    detailsActionId?: string;
    cartActionId?: string;
    checkoutActionId?: string;
    campaignId?: string;
    creativeId?: string;
    variant?: string;
    raw?: unknown;
}
export interface AdSnapshot {
    sourceId?: string;
    fetchedAt: number;
    items: AdItem[];
    raw?: unknown;
    error?: string;
}
export interface AdChatResult {
    sourceId: string;
    raw: unknown;
    text?: string;
}
export interface AdTargetingContext {
    locale?: string;
    path?: string;
    tags?: string[];
}
export declare class AdPetService {
    private readonly ctx;
    private readonly config;
    private snapshot;
    private sourceMap;
    private impressions;
    constructor(ctx: Context, config: ResolvedAdPetConfig);
    source(id?: string): AdSourceConfig | undefined;
    sources(): Array<Pick<AdSourceConfig, 'id' | 'name' | 'enabled' | 'metadata' | 'campaign' | 'targeting' | 'tracking'>>;
    private candidateSources;
    private frequencyKey;
    canServe(source: AdSourceConfig, item: AdItem, now?: number): boolean;
    markImpression(source: AdSourceConfig, item: AdItem, now?: number): void;
    refresh(sourceId?: string, context?: AdTargetingContext): Promise<AdSnapshot>;
    state(): AdSnapshot;
    action(sourceId: string, actionId: string, payload?: Record<string, unknown>): Promise<unknown>;
    track(sourceId: string, event: AdEventType, payload?: Record<string, unknown>): Promise<unknown>;
    chat(sourceId: string, payload: {
        message: string;
        history?: unknown[];
        assistantId?: string;
        sessionId?: string;
        productId?: string;
        locale?: string;
    }): Promise<AdChatResult>;
    chatStream(sourceId: string, payload: {
        message: string;
        history?: unknown[];
        assistantId?: string;
        sessionId?: string;
        productId?: string;
        locale?: string;
    }): Promise<Response>;
    media(sourceId: string, rawUrl: string): Promise<{
        bytes: Uint8Array;
        contentType: string;
    }>;
    interval(): number;
}
//# sourceMappingURL=service.d.ts.map