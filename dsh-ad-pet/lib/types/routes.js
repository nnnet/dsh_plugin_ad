import { API_PREFIX, MEDIA_PREFIX, MAX_CHAT_BYTES, MAX_JSON_BYTES } from "./constants.js";
import { ERRORS } from "./messages.js";
import { readJsonBody, writeJson } from "./http.js";
function guard(_ctx, _req, _res) { return true; }
function method(req, res, expected) {
    if (req.method === expected)
        return true;
    writeJson(res, 405, { ok: false, error: ERRORS.methodNotAllowed });
    return false;
}
function get(ctx, path, fn) {
    return { kind: 'exact', path, handler: (req, res) => {
            if (!guard(ctx, req, res) || !method(req, res, 'GET'))
                return;
            fn().then((value) => writeJson(res, 200, value), (error) => writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }));
        } };
}
function post(ctx, path, cap, fn) {
    return { kind: 'exact', path, handler: (req, res) => {
            if (!guard(ctx, req, res) || !method(req, res, 'POST'))
                return;
            readJsonBody(req, { maxBytes: cap, objectOnly: true }).then((parsed) => {
                fn((parsed ?? {})).then((value) => writeJson(res, 200, value), (error) => writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }));
            });
        } };
}
export function makeAdPetRoutes(ctx, service) {
    return [
        get(ctx, `${API_PREFIX}/state`, async () => service.state()),
        get(ctx, `${API_PREFIX}/sources`, async () => service.sources()),
        post(ctx, `${API_PREFIX}/refresh`, MAX_JSON_BYTES, async (body) => service.refresh(typeof body.sourceId === 'string' ? body.sourceId : undefined)),
        post(ctx, `${API_PREFIX}/action`, MAX_JSON_BYTES, async (body) => {
            if (typeof body.sourceId !== 'string' || typeof body.actionId !== 'string')
                throw new Error(ERRORS.missingSourceAndAction);
            return service.action(body.sourceId, body.actionId, body.payload && typeof body.payload === 'object' ? body.payload : {});
        }),
        post(ctx, `${API_PREFIX}/chat`, MAX_CHAT_BYTES, async (body) => {
            if (typeof body.sourceId !== 'string' || typeof body.message !== 'string')
                throw new Error(ERRORS.missingChatFields);
            const history = Array.isArray(body.history) ? body.history.slice(-50) : undefined;
            return service.chat(body.sourceId, { message: body.message, history, assistantId: typeof body.assistantId === 'string' ? body.assistantId : undefined, locale: typeof body.locale === 'string' ? body.locale : undefined });
        }),
        {
            kind: 'prefix', path: MEDIA_PREFIX,
            handler: (req, res) => {
                if (!guard(ctx, req, res) || !method(req, res, 'GET'))
                    return;
                const url = new URL(req.url ?? '/', 'http://ad-pet.local');
                const sourceId = url.searchParams.get('source');
                const target = url.searchParams.get('url');
                if (!sourceId || !target) {
                    writeJson(res, 400, { ok: false, error: ERRORS.missingMediaArguments });
                    return;
                }
                service.media(sourceId, target).then(({ bytes, contentType }) => {
                    res.writeHead(200, { 'content-type': contentType, 'content-length': String(bytes.byteLength), 'cache-control': 'private, max-age=300', 'referrer-policy': 'no-referrer' });
                    res.end(bytes);
                }, (error) => writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }));
            },
        },
    ];
}
