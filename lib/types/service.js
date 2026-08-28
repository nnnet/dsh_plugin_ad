import { getPath, renderTemplate, secret } from "./config.js";
import { MAX_JSON_BYTES, MAX_MEDIA_BYTES, REQUEST_TIMEOUT_MS } from "./constants.js";
import { ERRORS } from "./messages.js";
function isPrivateHostname(hostname) {
    const h = hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost') || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h);
}
function ensureUrl(raw, source) {
    const url = new URL(raw, source.baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        throw new Error(ERRORS.sourceUrlProtocol);
    const hostAllowed = source.allowHosts?.length ? source.allowHosts.some((host) => host === url.hostname || url.hostname.endsWith(`.${host}`)) : url.hostname === new URL(source.baseUrl).hostname;
    if (!hostAllowed)
        throw new Error(`${ERRORS.sourceHostNotAllowed}: ${url.hostname}`);
    if (!source.allowPrivateNetwork && isPrivateHostname(url.hostname))
        throw new Error(ERRORS.privateNetworkDisabled);
    return url;
}
async function readWithCap(response, cap) {
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > cap)
        throw new Error(ERRORS.responseTooLarge);
    const reader = response.body?.getReader();
    if (!reader)
        return new Uint8Array(await response.arrayBuffer());
    const chunks = [];
    let total = 0;
    while (true) {
        const part = await reader.read();
        if (part.done)
            break;
        total += part.value.byteLength;
        if (total > cap) {
            await reader.cancel();
            throw new Error(ERRORS.responseTooLarge);
        }
        chunks.push(part.value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}
function headersFor(source) {
    const headers = new Headers({ accept: 'application/json, text/plain, */*' });
    for (const [key, value] of Object.entries(source.request?.headers ?? {})) {
        const resolved = secret(value);
        if (resolved !== undefined)
            headers.set(key, resolved);
    }
    const auth = source.auth;
    if (auth?.token)
        headers.set(auth.tokenHeader ?? 'authorization', `Bearer ${secret(auth.token) ?? ''}`);
    for (const [key, value] of Object.entries(auth?.extraHeaders ?? {})) {
        const resolved = secret(value);
        if (resolved !== undefined)
            headers.set(key, resolved);
    }
    return headers;
}
function buildRequest(source, request = source.request, context = {}) {
    const url = ensureUrl(renderTemplate(request?.path ?? '/', context), source);
    for (const [key, value] of Object.entries(request?.query ?? {}))
        url.searchParams.set(key, String(renderTemplate(value, context)));
    const method = request?.method ?? 'GET';
    const headers = headersFor(source);
    let body;
    if (request?.body !== undefined) {
        body = JSON.stringify(renderTemplate(request.body, context));
        headers.set('content-type', 'application/json');
    }
    const username = secret(source.auth?.username);
    const password = secret(source.auth?.password);
    if (username !== undefined || password !== undefined)
        headers.set('authorization', `Basic ${Buffer.from(`${username ?? ''}:${password ?? ''}`).toString('base64')}`);
    return { url, method, headers, body };
}
async function fetchSource(source, request = source.request, context = {}, cap = MAX_JSON_BYTES) {
    const built = buildRequest(source, request, context);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), source.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(built.url, { method: built.method, headers: built.headers, body: built.body, signal: controller.signal, redirect: 'manual' });
        if (!response.ok)
            throw new Error(`source returned HTTP ${response.status}`);
        return { response, bytes: await readWithCap(response, cap) };
    }
    finally {
        clearTimeout(timer);
    }
}
function normalizeItems(source, raw) {
    const mapping = source.mapping ?? {};
    const selected = getPath(raw, mapping.itemsPath) ?? (Array.isArray(raw) ? raw : [raw]);
    if (!Array.isArray(selected))
        return [];
    return selected.slice(0, source.maxItems ?? 50).map((item, index) => {
        const type = String(getPath(item, mapping.typePath) ?? 'card');
        return {
            id: String(getPath(item, mapping.idPath) ?? `${source.id}-${index}`),
            type: ['text', 'image', 'gif', 'video', 'message', 'card', 'html', 'raw'].includes(type) ? type : 'raw',
            title: String(getPath(item, mapping.titlePath) ?? '') || undefined,
            text: String(getPath(item, mapping.textPath) ?? '') || undefined,
            description: String(getPath(item, mapping.descriptionPath) ?? '') || undefined,
            image: String(getPath(item, mapping.imagePath) ?? '') || undefined,
            media: String(getPath(item, mapping.mediaPath) ?? '') || undefined,
            url: String(getPath(item, mapping.urlPath) ?? '') || undefined,
            assistantId: String(getPath(item, mapping.assistantIdPath) ?? '') || undefined,
            raw: mapping.raw === false ? undefined : item,
        };
    });
}
export class AdPetService {
    ctx;
    config;
    snapshot = { fetchedAt: 0, items: [] };
    sourceMap = new Map();
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        for (const source of config.sources)
            this.sourceMap.set(source.id, source);
    }
    source(id) {
        const selected = id ?? this.config.source;
        if (selected)
            return this.sourceMap.get(selected);
        return [...this.sourceMap.values()].find((source) => source.enabled !== false);
    }
    sources() {
        return [...this.sourceMap.values()].map(({ id, name, enabled, metadata }) => ({ id, name, enabled, metadata }));
    }
    async refresh(sourceId) {
        if (!this.config.enabled)
            return this.snapshot;
        const source = this.source(sourceId);
        if (!source || source.enabled === false)
            return { fetchedAt: Date.now(), items: [] };
        try {
            const { response, bytes } = await fetchSource(source);
            const contentType = response.headers.get('content-type') ?? '';
            const raw = contentType.includes('json') ? JSON.parse(new TextDecoder().decode(bytes)) : { data: new TextDecoder().decode(bytes) };
            this.snapshot = { sourceId: source.id, fetchedAt: Date.now(), items: normalizeItems(source, raw), raw };
        }
        catch (error) {
            this.snapshot = { ...this.snapshot, sourceId: source.id, fetchedAt: Date.now(), error: error instanceof Error ? error.message : String(error) };
        }
        return this.snapshot;
    }
    state() { return this.snapshot; }
    async action(sourceId, actionId, payload = {}) {
        const source = this.sourceMap.get(sourceId);
        const action = source?.actions?.[actionId];
        if (!source || !action)
            throw new Error(ERRORS.unknownAction);
        const context = { payload, locale: payload.locale ?? 'en' };
        if (action.url)
            return { url: ensureUrl(renderTemplate(action.url, context), source).toString() };
        const result = await fetchSource(source, action, context);
        const contentType = result.response.headers.get('content-type') ?? '';
        return contentType.includes('json') ? JSON.parse(new TextDecoder().decode(result.bytes)) : new TextDecoder().decode(result.bytes);
    }
    async chat(sourceId, payload) {
        const source = this.sourceMap.get(sourceId);
        const actionId = source?.assistant?.action ?? 'chat';
        const action = source?.actions?.[actionId];
        if (!source || !action)
            throw new Error(ERRORS.assistantNotConfigured);
        const context = { payload: { ...payload, locale: payload.locale ?? 'en' }, locale: payload.locale ?? 'en' };
        const request = { ...action, body: action.body ?? {
                [source.assistant?.messageField ?? 'message']: '{{payload.message}}',
                [source.assistant?.historyField ?? 'history']: '{{payload.history}}',
                assistantId: '{{payload.assistantId}}',
                locale: '{{locale}}',
            } };
        const result = await fetchSource(source, request, context, MAX_JSON_BYTES);
        const contentType = result.response.headers.get('content-type') ?? '';
        const raw = contentType.includes('json') ? JSON.parse(new TextDecoder().decode(result.bytes)) : new TextDecoder().decode(result.bytes);
        return { sourceId, raw, text: typeof raw === 'string' ? raw : String(getPath(raw, 'text') ?? getPath(raw, 'message') ?? getPath(raw, 'answer') ?? '') || undefined };
    }
    async media(sourceId, rawUrl) {
        const source = this.sourceMap.get(sourceId);
        if (!source)
            throw new Error(ERRORS.unknownSource);
        const url = ensureUrl(rawUrl, source);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), source.timeoutMs ?? REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, { headers: headersFor(source), signal: controller.signal, redirect: 'manual' });
            if (!response.ok)
                throw new Error(`media returned HTTP ${response.status}`);
            const bytes = await readWithCap(response, MAX_MEDIA_BYTES);
            return { bytes, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
        }
        finally {
            clearTimeout(timer);
        }
    }
    interval() { return this.config.pollIntervalMs; }
}
