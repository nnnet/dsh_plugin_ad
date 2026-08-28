import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createElement, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { en, zh, t as translate, NS } from "../locales/index.js";
import { API_PREFIX, MEDIA_PREFIX } from "../constants.js";
async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok)
        throw new Error(`ad-pet ${response.status}`);
    return response.json();
}
function useLanguage() {
    const [lang, setLang] = useState(() => typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en');
    useEffect(() => {
        if (typeof document === 'undefined')
            return;
        const update = () => setLang(document.documentElement.lang || 'en');
        update();
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
        return () => observer.disconnect();
    }, []);
    return lang;
}
function anonymousSessionId() {
    try {
        const key = 'dsh-ad-pet-session';
        const existing = sessionStorage.getItem(key);
        if (existing)
            return existing;
        const value = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(key, value);
        return value;
    }
    catch {
        return 'ephemeral';
    }
}
function mediaUrl(sourceId, value) {
    return `${MEDIA_PREFIX}?source=${encodeURIComponent(sourceId)}&url=${encodeURIComponent(value)}`;
}
function ProductGallery({ sourceId, item }) {
    const images = [item.image, ...(item.gallery ?? [])].filter((v, i, a) => !!v && a.indexOf(v) === i).slice(0, 12);
    const [selected, setSelected] = useState(0);
    if (!images.length && !item.media)
        return null;
    const source = images[selected] ?? item.media;
    if (!source)
        return null;
    const video = item.type === 'video' || /\.(mp4|webm|mov)(?:$|\?)/i.test(source);
    return _jsxs("div", { children: [video
                ? _jsx("video", { src: mediaUrl(sourceId, source), controls: true, playsInline: true, muted: true, style: { width: '100%', borderRadius: 12, maxHeight: 290, display: 'block' } })
                : _jsx("img", { src: mediaUrl(sourceId, source), alt: item.title ?? '', style: { width: '100%', borderRadius: 12, maxHeight: 290, objectFit: 'cover', display: 'block' } }), images.length > 1 && _jsx("div", { style: { display: 'flex', gap: 6, overflowX: 'auto', marginTop: 6 }, children: images.map((image, i) => _jsx("button", { onClick: () => setSelected(i), "aria-label": `${i + 1}`, style: { padding: 0, border: i === selected ? '2px solid currentColor' : '1px solid #ddd', borderRadius: 7, background: 'transparent' }, children: _jsx("img", { src: mediaUrl(sourceId, image), alt: "", style: { width: 44, height: 44, objectFit: 'cover', borderRadius: 6, display: 'block' } }) }, image)) })] });
}
function Price({ item, lang }) {
    if (item.price === undefined && item.originalPrice === undefined)
        return null;
    const price = item.price === undefined ? '' : `${item.price} ${item.currency ?? ''}`.trim();
    const old = item.originalPrice === undefined ? '' : `${item.originalPrice} ${item.currency ?? ''}`.trim();
    return _jsxs("div", { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }, children: [price && _jsx("strong", { style: { fontSize: 21 }, children: price }), old && _jsx("span", { style: { textDecoration: 'line-through', opacity: .55 }, children: old }), item.discount !== undefined && _jsx("span", { style: { fontSize: 12, fontWeight: 700 }, children: translate('ad.discount', { value: item.discount }, lang) })] });
}
function Chat({ sourceId, item, lang }) {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [messages, setMessages] = useState([]);
    const [busy, setBusy] = useState(false);
    const [streaming, setStreaming] = useState('');
    if (!item.assistantId)
        return null;
    const send = async () => {
        const current = message.trim();
        if (!current || busy)
            return;
        const next = [...messages, { role: 'user', content: current }];
        setMessages(next);
        setMessage('');
        setBusy(true);
        setStreaming('');
        try {
            const response = await fetch(`${API_PREFIX}/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId, assistantId: item.assistantId, productId: item.productId, sessionId: anonymousSessionId(), message: current, history: next, locale: lang }) });
            if (!response.ok || !response.body)
                throw new Error('stream unavailable');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let accumulated = '';
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                buffer += decoder.decode(part.value, { stream: true });
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data:'))
                        continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === '[DONE]')
                        continue;
                    try {
                        const parsed = JSON.parse(payload);
                        const chunk = parsed.delta ?? parsed.text ?? parsed.content ?? parsed.answer ?? '';
                        if (chunk) {
                            accumulated += chunk;
                            setStreaming(accumulated);
                        }
                    }
                    catch {
                        if (payload) {
                            accumulated += payload;
                            setStreaming(accumulated);
                        }
                    }
                }
            }
            if (accumulated)
                setMessages((items) => [...items, { role: 'assistant', content: accumulated }]);
        }
        catch {
            setMessages((items) => [...items, { role: 'assistant', content: translate('ad.chatError', undefined, lang) }]);
        }
        finally {
            setStreaming('');
            setBusy(false);
        }
    };
    return _jsxs("div", { style: { marginTop: 10 }, children: [_jsx("button", { onClick: () => setOpen(!open), children: translate('ad.chat', undefined, lang) }), open && _jsxs("div", { style: { marginTop: 8, padding: 9, borderRadius: 10, background: '#f5f5f5' }, children: [_jsxs("div", { style: { maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }, children: [messages.map((entry, i) => _jsx("div", { style: { alignSelf: entry.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%', padding: '6px 8px', borderRadius: 8, background: entry.role === 'user' ? '#e8e8e8' : 'white' }, children: entry.content }, i)), streaming && _jsx("div", { style: { alignSelf: 'flex-start', maxWidth: '90%', padding: '6px 8px', borderRadius: 8, background: 'white' }, children: streaming })] }), _jsxs("div", { style: { display: 'flex', gap: 6, marginTop: 7 }, children: [_jsx("input", { value: message, onChange: (e) => setMessage(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                    void send(); }, placeholder: translate('ad.chatPlaceholder', undefined, lang), style: { flex: 1, minWidth: 0 } }), _jsx("button", { onClick: () => void send(), disabled: busy, children: busy ? translate('ad.chatThinking', undefined, lang) : translate('ad.chatSend', undefined, lang) })] })] })] });
}
function track(sourceId, event, payload) {
    void api(`${API_PREFIX}/track`, { sourceId, event, payload }).catch(() => undefined);
}
function ActionButton({ sourceId, actionId, payload, label, onResult }) {
    if (!actionId)
        return null;
    const run = async () => {
        try {
            const result = await api(`${API_PREFIX}/action`, { sourceId, actionId, payload });
            onResult?.(result);
        }
        catch {
            onResult?.(null);
        }
    };
    return _jsx("button", { onClick: () => { track(sourceId, 'click', { actionId, productId: payload.productId, campaignId: payload.campaignId, locale: payload.locale, sessionId: anonymousSessionId() }); void run(); }, style: { flex: 1 }, children: label });
}
function AdCard({ sourceId, item, lang, onClose }) {
    const [details, setDetails] = useState();
    useEffect(() => {
        track(sourceId, 'impression', { adId: item.id, campaignId: item.campaignId, creativeId: item.creativeId, variant: item.variant, productId: item.productId, locale: lang, sessionId: anonymousSessionId() });
    }, [sourceId, item.id, item.campaignId, item.creativeId, item.variant, item.productId, lang]);
    return _jsxs("div", { style: { width: 360, maxWidth: 'calc(100vw - 28px)', maxHeight: 'min(78vh, 760px)', overflowY: 'auto', background: 'white', color: '#111', borderRadius: 16, boxShadow: '0 10px 35px rgba(0,0,0,.22)', padding: 12, fontFamily: 'system-ui, sans-serif' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12, opacity: .72 }, children: [_jsx("span", { children: item.badge ?? translate('ad.sponsored', undefined, lang) }), _jsx("button", { "aria-label": translate('ad.close', undefined, lang), onClick: onClose, children: "\u00D7" })] }), _jsx(ProductGallery, { sourceId: sourceId, item: item }), item.brand && _jsx("div", { style: { marginTop: 8, fontSize: 12, opacity: .65 }, children: item.brand }), item.title && _jsx("div", { style: { fontSize: 18, fontWeight: 750, marginTop: 3 }, children: item.title }), item.rating !== undefined && _jsxs("div", { style: { marginTop: 4, fontSize: 13 }, children: ["\u2605 ", item.rating] }), _jsx(Price, { item: item, lang: lang }), item.text && _jsx("div", { style: { marginTop: 7, lineHeight: 1.45 }, children: item.text }), item.description && _jsx("div", { style: { marginTop: 6, fontSize: 13, opacity: .72 }, children: item.description }), _jsxs("div", { style: { display: 'flex', gap: 6, marginTop: 10 }, children: [_jsx(ActionButton, { sourceId: sourceId, actionId: item.detailsActionId, payload: { productId: item.productId, sku: item.sku, locale: lang }, label: translate('ad.details', undefined, lang), onResult: setDetails }), _jsx(ActionButton, { sourceId: sourceId, actionId: item.cartActionId, payload: { productId: item.productId, sku: item.sku, locale: lang }, label: translate('ad.addToCart', undefined, lang) }), item.url && _jsx("button", { onClick: () => { track(sourceId, 'click', { adId: item.id, campaignId: item.campaignId, creativeId: item.creativeId, productId: item.productId, locale: lang, sessionId: anonymousSessionId() }); window.open(item.url, '_blank', 'noopener,noreferrer'); }, style: { flex: 1 }, children: translate('ad.open', undefined, lang) })] }), details !== undefined && _jsx("pre", { style: { marginTop: 8, padding: 8, background: '#f5f5f5', borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 180, overflow: 'auto' }, children: JSON.stringify(details, null, 2) }), _jsx(Chat, { sourceId: sourceId, item: item, lang: lang })] });
}
function AdPet() {
    const lang = useLanguage();
    const [snapshot, setSnapshot] = useState({ fetchedAt: 0, items: [] });
    const [index, setIndex] = useState(0);
    const [hidden, setHidden] = useState(false);
    useEffect(() => {
        let alive = true;
        const load = async () => { try {
            const value = await api(`${API_PREFIX}/refresh`, { locale: lang, path: window.location.pathname, tags: [] });
            if (alive)
                setSnapshot(value);
        }
        catch {
            try {
                const value = await api(`${API_PREFIX}/state`);
                if (alive)
                    setSnapshot(value);
            }
            catch { }
        } };
        void load();
        const timer = window.setInterval(load, 60_000);
        return () => { alive = false; window.clearInterval(timer); };
    }, [lang]);
    const item = useMemo(() => snapshot.items[index % Math.max(snapshot.items.length, 1)], [snapshot.items, index]);
    if (hidden)
        return _jsx("button", { onClick: () => setHidden(false), style: { position: 'fixed', right: 20, bottom: 90, zIndex: 2147483647, border: 0, background: 'transparent', fontSize: 42, cursor: 'pointer' }, title: translate('ad.title', undefined, lang), children: "\uD83D\uDC3E" });
    return _jsxs("div", { "data-dsh-ad-pet-root": true, style: { position: 'fixed', right: 20, bottom: 20, zIndex: 2147483647, display: 'flex', alignItems: 'flex-end', gap: 8 }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [item ? _jsx(AdCard, { sourceId: snapshot.sourceId ?? '', item: item, lang: lang, onClose: () => setHidden(true) }) : _jsx("div", { style: { background: 'white', borderRadius: 12, padding: 12 }, children: translate('ad.noContent', undefined, lang) }), snapshot.items.length > 1 && _jsxs("div", { style: { display: 'flex', gap: 6, justifyContent: 'center' }, children: [_jsx("button", { onClick: () => setIndex((v) => (v - 1 + snapshot.items.length) % snapshot.items.length), children: translate('ad.previous', undefined, lang) }), _jsxs("span", { style: { padding: '5px 2px', fontSize: 12, opacity: .7 }, children: [index + 1, "/", snapshot.items.length] }), _jsx("button", { onClick: () => setIndex((v) => (v + 1) % snapshot.items.length), children: translate('ad.next', undefined, lang) })] })] }), _jsx("div", { title: translate('ad.poweredBy', undefined, lang), style: { fontSize: 46, filter: 'drop-shadow(0 5px 8px rgba(0,0,0,.2))' }, children: "\uD83D\uDC3E" })] });
}
export const inject = ['locale'];
export function apply(ctx) {
    ctx.effect(() => {
        try {
            return ctx.locale.register(NS, { en, zh });
        }
        catch {
            return () => { };
        }
    }, 'ad-pet: dictionaries');
    ctx.effect(() => {
        const container = document.createElement('div');
        container.dataset.dshAdPetRoot = '';
        document.body.appendChild(container);
        const root = createRoot(container);
        root.render(createElement(AdPet));
        return () => { root.unmount(); container.remove(); };
    }, 'ad-pet: ui');
}
