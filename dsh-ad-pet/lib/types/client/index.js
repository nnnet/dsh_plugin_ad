import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createElement, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { en, zh, t as translate } from "../locales/index.js";
import { NS } from "../locales/index.js";
import { API_PREFIX, MEDIA_PREFIX } from "../constants.js";
async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok)
        throw new Error(`ad-pet ${response.status}`);
    return response.json();
}
function useLanguage() {
    const [lang, setLang] = useState(() => typeof document === 'undefined' ? 'en' : document.documentElement.lang);
    useEffect(() => {
        if (typeof document === 'undefined')
            return;
        const observer = new MutationObserver(() => setLang(document.documentElement.lang));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
        return () => observer.disconnect();
    }, []);
    return lang;
}
function mediaUrl(sourceId, value) {
    return `${MEDIA_PREFIX}?source=${encodeURIComponent(sourceId)}&url=${encodeURIComponent(value)}`;
}
function AdMedia({ sourceId, item }) {
    const source = item.media ?? item.image;
    if (!source)
        return null;
    const src = mediaUrl(sourceId, source);
    if (item.type === 'video' || /\.mp4(?:$|\?)/i.test(source))
        return _jsx("video", { src: src, controls: true, playsInline: true, muted: true, style: { width: '100%', borderRadius: 12, maxHeight: 280 } });
    return _jsx("img", { src: src, alt: item.title ?? '', style: { width: '100%', borderRadius: 12, maxHeight: 280, objectFit: 'cover' } });
}
function Chat({ sourceId, item, lang }) {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [answer, setAnswer] = useState([]);
    const [busy, setBusy] = useState(false);
    if (!item.assistantId)
        return null;
    const send = async () => {
        if (!message.trim() || busy)
            return;
        const current = message.trim();
        setMessage('');
        setBusy(true);
        try {
            const result = await api(`${API_PREFIX}/chat`, { sourceId, assistantId: item.assistantId, message: current, history: answer.map((text) => ({ role: 'assistant', content: text })), locale: lang });
            if (result.text)
                setAnswer((items) => [...items, result.text]);
        }
        catch {
            setAnswer((items) => [...items, translate('ad.chatError', undefined, lang)]);
        }
        finally {
            setBusy(false);
        }
    };
    return _jsxs("div", { style: { marginTop: 10 }, children: [_jsx("button", { onClick: () => setOpen(!open), children: translate('ad.chat', undefined, lang) }), open && _jsxs("div", { style: { marginTop: 8, padding: 8, borderRadius: 10, background: '#f5f5f5' }, children: [answer.map((text, i) => _jsx("div", { style: { padding: '4px 0' }, children: text }, i)), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("input", { value: message, onChange: (e) => setMessage(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                    void send(); }, placeholder: translate('ad.chatPlaceholder', undefined, lang), style: { flex: 1 } }), _jsx("button", { onClick: () => void send(), disabled: busy, children: busy ? translate('ad.chatThinking', undefined, lang) : translate('ad.chatSend', undefined, lang) })] })] })] });
}
function AdCard({ sourceId, item, lang, onClose }) {
    return _jsxs("div", { style: { width: 330, maxWidth: 'calc(100vw - 28px)', background: 'white', color: '#111', borderRadius: 16, boxShadow: '0 10px 35px rgba(0,0,0,.22)', padding: 12, fontFamily: 'system-ui, sans-serif' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, opacity: .7 }, children: [_jsx("span", { children: translate('ad.sponsored', undefined, lang) }), _jsx("button", { "aria-label": translate('ad.close', undefined, lang), onClick: onClose, children: "\u00D7" })] }), _jsx(AdMedia, { sourceId: sourceId, item: item }), item.title && _jsx("div", { style: { fontSize: 17, fontWeight: 700, marginTop: 8 }, children: item.title }), item.text && _jsx("div", { style: { marginTop: 6, lineHeight: 1.45 }, children: item.text }), item.description && _jsx("div", { style: { marginTop: 6, fontSize: 13, opacity: .72 }, children: item.description }), _jsx(Chat, { sourceId: sourceId, item: item, lang: lang }), item.url && _jsx("button", { onClick: () => window.open(item.url, '_blank', 'noopener,noreferrer'), style: { marginTop: 10, width: '100%' }, children: translate('ad.open', undefined, lang) })] });
}
function AdPet() {
    const lang = useLanguage();
    const [snapshot, setSnapshot] = useState({ fetchedAt: 0, items: [] });
    const [index, setIndex] = useState(0);
    const [hidden, setHidden] = useState(false);
    useEffect(() => {
        let alive = true;
        const load = async () => { try {
            const value = await api(`${API_PREFIX}/state`);
            if (alive)
                setSnapshot(value);
        }
        catch { } };
        void load();
        const timer = window.setInterval(load, 60_000);
        return () => { alive = false; window.clearInterval(timer); };
    }, []);
    const item = useMemo(() => snapshot.items[index % Math.max(snapshot.items.length, 1)], [snapshot.items, index]);
    if (hidden)
        return _jsx("button", { onClick: () => setHidden(false), style: { position: 'fixed', right: 20, bottom: 90, zIndex: 2147483647, border: 0, background: 'transparent', fontSize: 42, cursor: 'pointer' }, title: translate('ad.title', undefined, lang), children: "\uD83D\uDC3E" });
    return _jsxs("div", { "data-dsh-ad-pet-root": true, style: { position: 'fixed', right: 20, bottom: 20, zIndex: 2147483647, display: 'flex', alignItems: 'flex-end', gap: 8 }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [item ? _jsx(AdCard, { sourceId: snapshot.sourceId ?? '', item: item, lang: lang, onClose: () => setHidden(true) }) : _jsx("div", { style: { background: 'white', borderRadius: 12, padding: 12 }, children: translate('ad.noContent', undefined, lang) }), snapshot.items.length > 1 && _jsxs("div", { style: { display: 'flex', gap: 6, justifyContent: 'center' }, children: [_jsx("button", { onClick: () => setIndex((v) => (v - 1 + snapshot.items.length) % snapshot.items.length), children: translate('ad.previous', undefined, lang) }), _jsx("button", { onClick: () => setIndex((v) => (v + 1) % snapshot.items.length), children: translate('ad.next', undefined, lang) })] })] }), _jsx("div", { title: translate('ad.poweredBy', undefined, lang), style: { fontSize: 46, filter: 'drop-shadow(0 5px 8px rgba(0,0,0,.2))' }, children: "\uD83D\uDC3E" })] });
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
