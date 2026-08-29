/**
 * dsh-ad host half — mounts the ad service and its HTTP routes. The browser
 * half (the './client' entry) renders the active source's rotating creative
 * (video/gif/image/text/message/html/card/raw) or a marketplace product
 * card with a media carousel, price/discount, CTAs, expandable details, a
 * cart drawer, and an AI-assistant chat with live token streaming. All
 * ad-source wiring — endpoints, credentials, content types, chat
 * integration, host allowlist, size caps, frequency cap, targeting, campaign
 * metadata — lives in `config.ts`'s `AdSourceConfig` and never touches host
 * or client code when a new source is added; only the config file changes.
 * @module dsh_plugin_ad
 */

import { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from 'schemastery'
import { AdService, AD_SETTINGS_NAMESPACE } from './service.ts'
import { makeAdRoutes } from './routes.ts'
import { adConfigSchema, loadConfigFromFile, type AdConfig } from './config.ts'
import { mountOnce } from './mount-once.ts'
import { PLUGIN_NAME } from './constants.ts'

export { AdService, AD_SETTINGS_NAMESPACE } from './service.ts'
export type { AdSourceView, AdRuntimeContext } from './service.ts'
export type {
  AdConfig,
  AdSourceConfig,
  AdContentType,
  AdActionConfig,
  AdCredentials,
  AdEndpointConfig,
  AdFrequencyCap,
  AdTargetingConfig,
} from './config.ts'
export { adConfigSchema, adSourceSchema, resolveCredentials, resolveSecret, loadConfigFromFile } from './config.ts'
export type { ResolvedAdCredentials } from './config.ts'
export type { AdItem } from './adapter.ts'
export type { MarketplaceExtras } from './marketplace-renderer.ts'
export {
  normalizeMarketplaceItem,
  readMarketplaceExtras,
  formatPriceLabel,
  defaultCtas,
  defaultDetails,
  campaignLabel,
  absolutizeMedia,
  firstMediaUrl,
} from './marketplace-renderer.ts'
export { buildCsgoMarketSource, csgoFeedEntry, csgoImageUrl, steamImageUrl, steamListingUrl, dotaPriceFeedUrl, dotaImageUrl } from './sources/index.ts'
export type { CsgoMarketOptions } from './sources/index.ts'
export { AD_API_PREFIX, makeAdRoutes } from './routes.ts'
export { PLUGIN_NAME } from './constants.ts'
export { ERRORS } from './messages.ts'

/** Stable cordis plugin name. */
export const name = 'ad'

/** Services required before the ad widget can mount its surfaces. */
export const inject = ['webServer']

/** Plugin-level config schema (re-exported at the top for `dsh plugin` tooling). */
export const Config: z<AdConfig> = adConfigSchema

/**
 * Pet-style settings schema: which source is active, whether the widget
 * is shown at all, and where on the viewport it sits (size + right/bottom
 * insets updated by drag-and-drop). Per-source endpoint/credential
 * configuration is deliberately *not* exposed here — that lives in the
 * plugin config file, not the settings UI, so secrets never round-trip
 * through the browser-editable settings document.
 *
 * Field meanings mirror dsh-pet's `PetSettings` so the same
 * `PluginSettingsCard` chrome renders both plugins without per-plugin
 * fork.
 */
export interface AdWidgetSettings {
  enabled: boolean
  visible: boolean
  decorationEnabled: boolean
  size: number
  right: number
  bottom: number
  activeSourceId: string
}

export function makeAdSettingsSchema(sourceIds: string[]): z<AdWidgetSettings> {
  return z.object({
    enabled: z.boolean().default(true),
    visible: z.boolean().default(true),
    decorationEnabled: z.boolean().default(true),
    size: z.number().min(200).max(800).default(360),
    right: z.number().min(0).max(200).default(24),
    bottom: z.number().min(0).max(200).default(20),
    activeSourceId: sourceIds.length > 0
      ? z.union(sourceIds.map((id) => z.const(id))).default(sourceIds[0]!)
      : z.string(),
  }) as unknown as z<AdWidgetSettings>
}

interface AdSettingsSection {
  enabled?: boolean
  visible?: boolean
  decorationEnabled?: boolean
  size?: number
  right?: number
  bottom?: number
  activeSourceId?: string
}

/** Register the ad service and its API routes on the context. */
export const apply = mountOnce(PLUGIN_NAME, applyImpl)

function applyImpl(ctx: Context, config: AdConfig = {}): void {
  // Resolve configFile *before* service construction so the service sees the
  // merged final view (the service re-applies the same loader for safety;
  // doing it twice is cheap and keeps the service self-contained).
  const merged = loadConfigFromFile(config)
  const service = new AdService(ctx, merged)
  service.setEnabled(merged.enabled ?? true)

  const sourceIds = service.listSources().map((s) => s.id)
  let current: () => AdSettingsSection = () => base
  const base: AdSettingsSection = {
    enabled: merged.enabled ?? true,
    visible: merged.widget?.visible ?? true,
    decorationEnabled: merged.widget?.decorationEnabled ?? true,
    size: merged.widget?.size ?? 360,
    right: merged.widget?.right ?? 24,
    bottom: merged.widget?.bottom ?? 20,
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
    {
      enabled: base.enabled ?? true,
      visible: base.visible ?? true,
      decorationEnabled: base.decorationEnabled ?? true,
      size: base.size ?? 360,
      right: base.right ?? 24,
      bottom: base.bottom ?? 20,
      activeSourceId: base.activeSourceId ?? '',
    },
    {
      setSource: (source) => {
        current = source
        // Push live widget changes into the service so /api/ad/sources
        // and /api/ad/display reflect the new appearance immediately.
        const s = source()
        service.setDisplay({
          visible: s.visible,
          enabled: s.enabled,
          decorationEnabled: s.decorationEnabled,
          size: s.size,
          right: s.right,
          bottom: s.bottom,
        })
        if (s.activeSourceId !== undefined) service.setActiveSourceId(s.activeSourceId)
      },
      onChange: () => { syncRoutes() },
    },
  )
  syncRoutes()
}
