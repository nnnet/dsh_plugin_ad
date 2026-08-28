import type { Context } from '@deepseek-ai/cordis';
import type { AdSourceConfig, ResolvedAdPetConfig } from './config.ts';
export type AdContentType = 'text' | 'image' | 'gif' | 'video' | 'message' | 'card' | 'html' | 'raw';
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
export declare class AdPetService {
    private readonly ctx;
    private readonly config;
    private snapshot;
    private sourceMap;
    constructor(ctx: Context, config: ResolvedAdPetConfig);
    source(id?: string): AdSourceConfig | undefined;
    sources(): Array<Pick<AdSourceConfig, 'id' | 'name' | 'enabled' | 'metadata'>>;
    refresh(sourceId?: string): Promise<AdSnapshot>;
    state(): AdSnapshot;
    action(sourceId: string, actionId: string, payload?: Record<string, unknown>): Promise<unknown>;
    chat(sourceId: string, payload: {
        message: string;
        history?: unknown[];
        assistantId?: string;
        locale?: string;
    }): Promise<AdChatResult>;
    media(sourceId: string, rawUrl: string): Promise<{
        bytes: Uint8Array;
        contentType: string;
    }>;
    interval(): number;
}
//# sourceMappingURL=service.d.ts.map