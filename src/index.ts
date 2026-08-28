/**
 * dsh-ad host half — mounts the ad service and its HTTP routes. The browser
 * half (the './client' entry) renders the active source's rotating creative
 * (video/gif/image/text/message) or a chat surface, and drives it through
 * the same-origin '/api/ad/*' JSON endpoints. All ad-source wiring —
 * endpoints, credentials, content types, chat integration — lives in
 * config.ts's AdSourceConfig and never touches host or client code when a
 * new source is added; only the config file changes.
 * @module @linxin666/dsh-ad
 */

import { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'
import { AdService, AD_SETTINGS_NAMESPACE } from './service.ts'
import { makeAdRoutes } from './routes.ts'
import { adConfigSchema, type AdConfig } from './config.ts'
import { mountOnce } from './mount-once.ts'

export { AdService, AD_SETTINGS_NAMESPACE } from './service.ts'
export type { AdSourceView } from './service.ts'
export type { AdConfig, AdSourceConfig, AdContentType, AdCredentials, AdEndpointConfig } from './config.ts'
export { adConfigSchema, adSourceSchema, resolveCredentials, resolveSecret } from './config.ts'
export type { AdItem } from './adapter.ts'
export { AD_API_PREFIX, makeAdRoutes } from './routes.ts'

/** Stable cordis plugin name. */
export const name = 'ad'

/** Services required before the ad widget can mount its surfaces. */
export const inject = ['webServer']

/** Plugin-level config schema (re-exported at the top for `dsh plugin` tooling). */
export const Config: z<AdConfig> = adConfigSchema

/**
 * Settings section schema: which source is active and whether the widget is
 * shown at all. Per-source endpoint/credential configuration is deliberately
 * *not* exposed here — that lives in the plugin config file, not the
 * settings UI, so secrets never round-trip through the browser-editable
 * settings document.
 */
export function makeAdSettingsSchema(sourceIds: string[]) {
  return z.object({
    enabled: z.boolean().default(true),
    visible: z.boolean().default(true),
    activeSourceId: sourceIds.length > 0
      ? z.union(sourceIds.map((id) => z.const(id))).default(sourceIds[0])
      : z.string(),
  })
}

interface AdSettingsSection {
  enabled?: boolean
  visible?: boolean
  activeSourceId?: string
}

/** Register the ad service and its API routes on the context. */
export const apply = mountOnce('@linxin666/dsh-ad', applyImpl)

function applyImpl(ctx: Context, config: AdConfig = {}): void {
  const service = new AdService(ctx, config)
  service.setEnabled(config.enabled ?? true)

  const sourceIds = service.listSources().map((s) => s.id)
  let current: () => AdSettingsSection = () => base
  const base: AdSettingsSection = {
    enabled: config.enabled ?? true,
    visible: true,
    activeSourceId: service.defaultSourceId(),
  }

  const routes = makeAdRoutes({ service, ctx })
  let disposeRoutes: (() => void) | undefined
  const syncRoutes = (): void => {
    const enabled = current().enabled ?? true
    service.setEnabled(enabled)
    if (disposeRoutes === undefined && enabled) {
      disposeRoutes = ctx.effect(
        () => {
          const disposers = routes.map((route) => ctx.webServer.register(route))
          return () => { for (const dispose of disposers) dispose() }
        },
        'ad: routes',
      )
    } else if (disposeRoutes !== undefined && !enabled) {
      disposeRoutes()
      disposeRoutes = undefined
    }
  }

  installSettingsSection(
    ctx,
    settingsNamespace(AD_SETTINGS_NAMESPACE),
    makeAdSettingsSchema(sourceIds),
    base,
    {
      setSource: (source) => { current = source },
      onChange: () => { syncRoutes() },
    },
  )
  syncRoutes()
}
