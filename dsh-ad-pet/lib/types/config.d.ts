export type SecretValue = string | {
    env: string;
};
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface AdSourceAuth {
    username?: SecretValue;
    password?: SecretValue;
    token?: SecretValue;
    tokenHeader?: string;
    extraHeaders?: Record<string, string | SecretValue>;
}
export interface AdRequestConfig {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
    path?: string;
    query?: Record<string, string | number | boolean>;
    headers?: Record<string, string | SecretValue>;
    body?: JsonValue;
}
export interface AdActionConfig extends AdRequestConfig {
    /** Open a URL instead of calling an API. If both are present, url wins. */
    url?: string;
    /** Response path containing the URL when url is omitted. */
    urlPath?: string;
}
export interface AdMappingConfig {
    /** Path to the array of creatives. */
    itemsPath?: string;
    /** Paths inside each creative. */
    idPath?: string;
    typePath?: string;
    titlePath?: string;
    textPath?: string;
    descriptionPath?: string;
    imagePath?: string;
    mediaPath?: string;
    urlPath?: string;
    assistantIdPath?: string;
    /** Extra fields are copied from the raw creative object. */
    raw?: boolean;
}
export interface AdSourceConfig {
    id: string;
    name: string | {
        en?: string;
        zh?: string;
    };
    baseUrl: string;
    enabled?: boolean;
    allowHosts?: string[];
    allowPrivateNetwork?: boolean;
    auth?: AdSourceAuth;
    request?: AdRequestConfig;
    mapping?: AdMappingConfig;
    actions?: Record<string, AdActionConfig>;
    assistant?: {
        action?: string;
        sessionField?: string;
        messageField?: string;
        historyField?: string;
    };
    pollIntervalMs?: number;
    timeoutMs?: number;
    maxItems?: number;
    /** Arbitrary source-specific metadata; never interpreted by the plugin. */
    metadata?: Record<string, JsonValue>;
}
export interface AdPetConfig {
    enabled?: boolean;
    source?: string;
    sources?: AdSourceConfig[];
    configFile?: string;
    pollIntervalMs?: number;
}
export interface ResolvedAdPetConfig {
    enabled: boolean;
    source?: string;
    sources: AdSourceConfig[];
    pollIntervalMs: number;
}
export declare function secret(value: SecretValue | undefined, env?: NodeJS.ProcessEnv): string | undefined;
export declare function resolveConfig(input?: AdPetConfig, env?: NodeJS.ProcessEnv): ResolvedAdPetConfig;
/** Dot-path lookup used by mappings and URL/body templates. */
export declare function getPath(value: unknown, path: string | undefined): unknown;
export declare function renderTemplate(value: unknown, context: Record<string, unknown>): unknown;
//# sourceMappingURL=config.d.ts.map