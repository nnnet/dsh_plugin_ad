import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveConfig, type AdPetConfig } from './config.ts'
import { AdPetService } from './service.ts'
import { makeAdPetRoutes } from './routes.ts'
import { mountOnce } from './mount-once.ts'

export { AdPetService } from './service.ts'
export type { AdContentType, AdItem, AdSnapshot } from './service.ts'
export type {
  AdActionConfig,
  AdMappingConfig,
  AdPetConfig,
  AdRequestConfig,
  AdSourceAuth,
  AdSourceConfig,
  JsonValue,
  ResolvedAdPetConfig,
  SecretValue,
} from './config.ts'
export { resolveConfig, getPath, renderTemplate, secret } from './config.ts'
export { API_PREFIX, MEDIA_PREFIX } from './constants.ts'

export const name = 'ad-pet'
export const inject = ['webServer']

export const apply = mountOnce('@linxin666/dsh-ad-pet', applyImpl)

function applyImpl(ctx: Context, config: AdPetConfig = {}): void {
  const resolved = resolveConfig(config)
  const service = new AdPetService(ctx, resolved)
  const routes = makeAdPetRoutes(ctx, service)
  const disposers = routes.map((route) => ctx.webServer.register(route))
  if (resolved.enabled) void service.refresh(resolved.source)
  const timer = resolved.enabled ? setInterval(() => void service.refresh(resolved.source), resolved.pollIntervalMs) : undefined
  ctx.effect(() => () => {
    if (timer) clearInterval(timer)
    for (const dispose of disposers) dispose()
  }, 'ad-pet: lifecycle')
}
