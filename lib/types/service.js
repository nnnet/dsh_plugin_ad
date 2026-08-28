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
function headersFor(source, context = {}) {
    const headers = new Headers({ accept: 'application/json, text/plain, */*' });
    for (const [key, value] of Object.entries(source.request?.headers ?? {})) {
        const resolved = secret(typeof value === 'string' ? renderTemplate(value, context) : value);
        if (resolved !== undefined)
            headers.set(key, resolved);
    }
    const auth = source.auth;
    if (auth?.token)
        headers.set(auth.tokenHeader ?? 'authorization', `Bearer ${secret(auth.token) ?? ''}`);
    for (const [key, value] of Object.entries(auth?.extraHeaders ?? {})) {
        const resolved = secret(typeof value === 'string' ? renderTemplate(value, context) : value);
        if (resolved !== undefined)
            headers.set(key, resolved);
    }
    return headers;
}
function buildRequest(source, request = source.request, context = {}) {
    const path = renderTemplate(request?.path ?? '/', context);
    const url = ensureUrl(path, source);
    for (const [key, value] of Object.entries(request?.query ?? {}))
        url.searchParams.set(key, String(renderTemplate(value, context)));
    const method = request?.method ?? 'GET';
    const headers = headersFor(source, context);
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
function matchesTargeting(source, context) {
    const t = source.targeting;
    if (!t)
        return true;
    if (t.locales?.length && (!context.locale || !t.locales.includes(context.locale)))
        return false;
    if (context.path) {
        if (t.paths?.length && !t.paths.some((p) => context.path === p || context.path.startsWith(p.endsWith('/') ? p : `${p}/`)))
            return false;
        if (t.excludePaths?.some((p) => context.path === p || context.path.startsWith(p.endsWith('/') ? p : `${p}/`)))
            return false;
    }
    const tags = new Set(context.tags ?? []);
    if (t.tags?.length && !t.tags.some((tag) => tags.has(tag)))
        return false;
    if (t.excludeTags?.some((tag) => tags.has(tag)))
        return false;
    return true;
}
function normalizeItems(source, raw) {
    const mapping = source.mapping ?? {};
    const selected = getPath(raw, mapping.itemsPath) ?? (Array.isArray(raw) ? raw : [raw]);
    if (!Array.isArray(selected))
        return [];
    return selected.slice(0, source.maxItems ?? 50).map((item, index) => {
        const type = String(getPath(item, mapping.typePath) ?? 'card');
        const campaignId = source.campaign?.campaignIdPath ? getPath(item, source.campaign.campaignIdPath) : undefined;
        const creativeId = source.campaign?.creativeIdPath ? getPath(item, source.campaign.creativeIdPath) : getPath(item, mapping.idPath);
        const variant = source.campaign?.variantPath ? getPath(item, source.campaign.variantPath) : undefined;
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
            productId: String(getPath(item, mapping.productIdPath) ?? '') || undefined,
            sku: String(getPath(item, mapping.skuPath) ?? '') || undefined,
            price: getPath(item, mapping.pricePath),
            originalPrice: getPath(item, mapping.originalPricePath),
            currency: String(getPath(item, mapping.currencyPath) ?? '') || undefined,
            discount: getPath(item, mapping.discountPath),
            brand: String(getPath(item, mapping.brandPath) ?? '') || undefined,
            rating: getPath(item, mapping.ratingPath),
            badge: String(getPath(item, mapping.badgePath) ?? '') || undefined,
            gallery: (() => { const value = getPath(item, mapping.galleryPath); return Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, 12) : undefined; })(),
            detailsActionId: String(getPath(item, mapping.detailsActionIdPath) ?? source.commerce?.detailsAction ?? '') || undefined,
            cartActionId: source.commerce?.cartAction,
            checkoutActionId: source.commerce?.checkoutAction,
            campaignId: campaignId == null ? undefined : String(campaignId),
            creativeId: creativeId == null ? undefined : String(creativeId),
            variant: variant == null ? undefined : String(variant),
            raw: mapping.raw === false ? undefined : item,
        };
    });
}
export class AdPetService {
    ctx;
    config;
    snapshot = { fetchedAt: 0, items: [] };
    sourceMap = new Map();
    impressions = new Map();
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
        return [...this.sourceMap.values()].filter((source) => source.enabled !== false).sort((a, b) => (b.campaign?.priority ?? 0) - (a.campaign?.priority ?? 0))[0];
    }
    sources() {
        return [...this.sourceMap.values()].map(({ id, name, enabled, metadata, campaign, targeting, tracking }) => ({ id, name, enabled, metadata, campaign, targeting, tracking }));
    }
    candidateSources(context) {
        const explicit = this.config.source ? this.sourceMap.get(this.config.source) : undefined;
        const list = explicit ? [explicit] : [...this.sourceMap.values()];
        return list.filter((source) => source.enabled !== false && matchesTargeting(source, context)).sort((a, b) => {
            const priority = (b.campaign?.priority ?? 0) - (a.campaign?.priority ?? 0);
            if (priority)
                return priority;
            return (b.campaign?.weight ?? 1) - (a.campaign?.weight ?? 1);
        });
    }
    frequencyKey(source, item) { return `${source.id}:${item.campaignId ?? item.id}`; }
    canServe(source, item, now = Date.now()) {
        const cap = source.tracking?.frequencyCap;
        if (!cap || cap.maxImpressions <= 0 || cap.windowMs <= 0)
            return true;
        const key = this.frequencyKey(source, item);
        const recent = (this.impressions.get(key) ?? []).filter((entry) => now - entry.at < cap.windowMs);
        this.impressions.set(key, recent);
        return recent.length < cap.maxImpressions;
    }
    markImpression(source, item, now = Date.now()) {
        const key = this.frequencyKey(source, item);
        const recent = (this.impressions.get(key) ?? []).filter((entry) => now - entry.at < (source.tracking?.frequencyCap?.windowMs ?? 86_400_000));
        recent.push({ at: now });
        this.impressions.set(key, recent);
    }
    async refresh(sourceId, context = this.config.targeting ?? {}) {
        if (!this.config.enabled)
            return this.snapshot;
        const candidates = sourceId ? [this.sourceMap.get(sourceId)].filter((x) => Boolean(x)) : this.candidateSources(context);
        let lastError = '';
        for (const source of candidates) {
            try {
                const requestContext = { locale: context.locale ?? 'en', path: context.path ?? '/', tags: context.tags ?? [], targeting: context };
                const { response, bytes } = await fetchSource(source, source.request, requestContext);
                const contentType = response.headers.get('content-type') ?? '';
                const raw = contentType.includes('json') ? JSON.parse(new TextDecoder().decode(bytes)) : { data: new TextDecoder().decode(bytes) };
                const items = normalizeItems(source, raw).filter((item) => this.canServe(source, item));
                if (!items.length && candidates.length > 1)
                    continue;
                this.snapshot = { sourceId: source.id, fetchedAt: Date.now(), items, raw };
                return this.snapshot;
            }
            catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
        }
        this.snapshot = { ...this.snapshot, fetchedAt: Date.now(), error: lastError || ERRORS.noEligibleSource };
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
        const raw = contentType.includes('json') ? JSON.parse(new TextDecoder().decode(result.bytes)) : new TextDecoder().decode(result.bytes);
        if (action.urlPath) {
            const target = getPath(raw, action.urlPath);
            if (typeof target === 'string')
                return { url: ensureUrl(target, source).toString() };
        }
        return raw;
    }
    async track(sourceId, event, payload = {}) {
        const source = this.sourceMap.get(sourceId);
        if (!source)
            throw new Error(ERRORS.unknownSource);
        const actionId = source.tracking?.action ?? source.commerce?.trackAction;
        if (!actionId)
            return { ok: true, skipped: true };
        const eventName = event === 'impression' ? (source.tracking?.impressionEvent ?? 'impression') : event === 'click' ? (source.tracking?.clickEvent ?? 'click') : (source.tracking?.conversionEvent ?? 'conversion');
        return this.action(sourceId, actionId, { ...payload, event: eventName, locale: payload.locale ?? 'en' });
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
                ...(source.assistant?.sessionField ? { [source.assistant.sessionField]: '{{payload.sessionId}}' } : {}),
                assistantId: '{{payload.assistantId}}', productId: '{{payload.productId}}', locale: '{{locale}}',
            } };
        const result = await fetchSource(source, request, context, MAX_JSON_BYTES);
        const contentType = result.response.headers.get('content-type') ?? '';
        const raw = contentType.includes('json') ? JSON.parse(new TextDecoder().decode(result.bytes)) : new TextDecoder().decode(result.bytes);
        return { sourceId, raw, text: typeof raw === 'string' ? raw : String(getPath(raw, 'text') ?? getPath(raw, 'message') ?? getPath(raw, 'answer') ?? '') || undefined };
    }
    async chatStream(sourceId, payload) {
        const source = this.sourceMap.get(sourceId);
        const actionId = source?.assistant?.action ?? 'chat';
        const action = source?.actions?.[actionId];
        if (!source || !action)
            throw new Error(ERRORS.assistantNotConfigured);
        const context = { payload: { ...payload, locale: payload.locale ?? 'en' }, locale: payload.locale ?? 'en' };
        const request = { ...action, stream: true, body: action.body ?? {
                [source.assistant?.messageField ?? 'message']: '{{payload.message}}',
                [source.assistant?.historyField ?? 'history']: '{{payload.history}}',
                ...(source.assistant?.sessionField ? { [source.assistant.sessionField]: '{{payload.sessionId}}' } : {}),
                assistantId: '{{payload.assistantId}}', productId: '{{payload.productId}}', locale: '{{locale}}',
            } };
        const built = buildRequest(source, request, context);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), source.timeoutMs ?? REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(built.url, { method: built.method, headers: built.headers, body: built.body, signal: controller.signal, redirect: 'manual' });
            if (!response.ok)
                throw new Error(`assistant returned HTTP ${response.status}`);
            if (!response.body)
                throw new Error(ERRORS.streamUnavailable);
            return response;
        }
        finally {
            clearTimeout(timer);
        }
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
