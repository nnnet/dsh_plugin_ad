import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_POLL_MS, MAX_ITEMS, MAX_POLL_MS, MIN_POLL_MS, REQUEST_TIMEOUT_MS } from "./constants.js";
export function secret(value, env = process.env) {
    if (value === undefined)
        return undefined;
    if (typeof value === 'string')
        return value;
    return env[value.env];
}
function clampPoll(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return DEFAULT_POLL_MS;
    return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(value)));
}
export function resolveConfig(input = {}, env = process.env) {
    let fileConfig = {};
    const file = input.configFile ?? env.DSH_AD_PET_CONFIG;
    if (file) {
        const path = resolve(file.replace(/^~(?=\/|\\)/, env.HOME ?? process.cwd()));
        if (existsSync(path)) {
            const parsed = JSON.parse(readFileSync(path, 'utf8'));
            fileConfig = parsed;
        }
    }
    const merged = { ...fileConfig, ...input };
    const sources = (merged.sources ?? []).map((source) => ({
        ...source,
        enabled: source.enabled ?? true,
        pollIntervalMs: clampPoll(source.pollIntervalMs ?? merged.pollIntervalMs),
        timeoutMs: Math.min(120_000, Math.max(1_000, Math.round(source.timeoutMs ?? REQUEST_TIMEOUT_MS))),
        maxItems: Math.min(MAX_ITEMS, Math.max(1, Math.round(source.maxItems ?? MAX_ITEMS))),
    }));
    return { enabled: merged.enabled ?? true, source: merged.source, sources, pollIntervalMs: clampPoll(merged.pollIntervalMs), targeting: merged.targeting };
}
/** Dot-path lookup used by mappings and URL/body templates. */
export function getPath(value, path) {
    if (!path)
        return undefined;
    let current = value;
    for (const part of path.split('.')) {
        if (part === '')
            continue;
        if (Array.isArray(current) && /^\d+$/.test(part))
            current = current[Number(part)];
        else if (typeof current === 'object' && current !== null)
            current = current[part];
        else
            return undefined;
    }
    return current;
}
export function renderTemplate(value, context) {
    if (typeof value === 'string')
        return value.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_, path) => String(getPath(context, path) ?? ''));
    if (Array.isArray(value))
        return value.map((item) => renderTemplate(item, context));
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, context)]));
    return value;
}
