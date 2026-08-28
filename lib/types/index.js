import { resolveConfig } from "./config.js";
import { AdPetService } from "./service.js";
import { makeAdPetRoutes } from "./routes.js";
import { mountOnce } from "./mount-once.js";
export { AdPetService } from "./service.js";
export { resolveConfig, getPath, renderTemplate, secret } from "./config.js";
export { API_PREFIX, MEDIA_PREFIX } from "./constants.js";
export const name = 'ad-pet';
export const inject = ['webServer'];
export const apply = mountOnce('@linxin666/dsh-ad-pet', applyImpl);
function applyImpl(ctx, config = {}) {
    const resolved = resolveConfig(config);
    const service = new AdPetService(ctx, resolved);
    const routes = makeAdPetRoutes(ctx, service);
    const disposers = routes.map((route) => ctx.webServer.register(route));
    if (resolved.enabled)
        void service.refresh(resolved.source);
    const timer = resolved.enabled ? setInterval(() => void service.refresh(resolved.source), resolved.pollIntervalMs) : undefined;
    ctx.effect(() => () => {
        if (timer)
            clearInterval(timer);
        for (const dispose of disposers)
            dispose();
    }, 'ad-pet: lifecycle');
}
