/**
 * dsh-ad browser half — mounts the ad widget as a global floating surface,
 * the same way dsh-pet mounts its sprite: directly onto `document.body` via
 * a single React root, so it survives session/route changes instead of
 * living inside a session-scoped dock slot. The host settings toggle
 * (`ad.visible` / `ad.enabled`) controls whether the widget has any content
 * to show, not whether the root itself exists.
 *
 * Also registers a first-level settings page under the `'settings.section'`
 * slot with id `'ad'`, so the dsh Settings sidebar shows an «Ad» entry
 * next to «Pet» (Pet-style settings card: enabled/visible/decoration
 * toggles, size + right/bottom insets, source picker).
 *
 * ## Required services
 *
 * The dsh-client-runtime contract is declared via the `inject` array.
 * `slots` powers the settings section registration; `locale` powers the
 * nav label and the card's `t` seat; `connection`/`settingsScope` give us
 * the per-namespace scope the card binds. `remote` is the shared wire
 * handle some compositions expect; the cordis boot fails to apply this
 * plugin when any of these are missing.
 *
 * ## Standalone-build compatibility
 *
 * This plugin is published both as a standalone package and as a consumer
 * inside the dsh-web-all monorepo. In the monorepo, `ctx.locale` is typed
 * by `@deepseek-ai/dsh-client-locale` via cordis module augmentation. The
 * standalone npm build (this directory's `node_modules`) does not install
 * that package, so this file reads `ctx.get('locale')` and casts the
 * returned service to the local `LocaleFace` shape. In the monorepo the
 * `dsh-client-locale` augmentation is structurally identical (the install
 * via `slots.installLocale(face)` plugs the same `{ register, bind }`
 * surface), so both build contexts type-check and run unchanged.
 * @module dsh_plugin_ad/client
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext, SettingsScope, SettingsScopeSpec } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings-surface SlotMap merge ('settings.section' owner).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AdWidget } from './AdWidget.tsx'
import { AdSettingsCardController, AdSettingsSection, type AdSettings, type AdSettingsCardFace } from './AdSettingsCard.tsx'
import { NS, en, zh } from './locales.ts'

export { AdWidget } from './AdWidget.tsx'
export { MarketplaceRenderer } from './MarketplaceRenderer.tsx'
export { SimpleCreative } from './SimpleCreative.tsx'
export { ProductCarousel } from './ProductCarousel.tsx'
export { PriceTag } from './PriceTag.tsx'
export { CtaRow } from './CtaRow.tsx'
export { ProductDetails } from './ProductDetails.tsx'
export { ChatPanel } from './ChatPanel.tsx'
export { CartDrawer } from './CartDrawer.tsx'
export type { AdItemView, AdMedia, AdPrice, AdCta, AdDetails, CartLineView, SourceView, ChatTurn } from './types.ts'
export { NS, en, zh, t, dictionary } from './locales.ts'
export { AdSettingsCardController, AdSettingsSection, AdSettingsCard } from './AdSettingsCard.tsx'
export type { AdSettings, AdSettingsCardState, AdSettingsCardFace } from './AdSettingsCard.tsx'

/** Settings namespace the ad settings card edits (matches host plugin). */
const AD_SETTINGS_NS = 'ad'

/**
 * Minimal shape the locale service exposes to this plugin: namespace
 * registration and namespace-bounded translate. The real `dsh-client-locale`
 * is structurally identical (see its `LocaleFace` declaration), so this
 * local shape is source-compatible with the runtime install. The name
 * avoids `LocaleFace` from `@deepseek-ai/dsh-client-ui-slots` (imported
 * transitively by the runtime types) which would shadow this declaration
 * in the standalone build where the ui-slots package is not installed.
 */
interface AdLocaleFace {
  register(ns: string, dicts: { readonly [k: string]: { readonly [k: string]: string } }): () => void
  bind(ns: string): (key: string, params?: Record<string, string | number>) => string
}

/**
 * Resolve the locale service through cordis's typed `get(key)` and a
 * type assertion. In the monorepo the augmentation from `dsh-client-locale`
 * makes the cast a no-op; in the standalone build the cast bridges the
 * missing `Context.locale` field.
 */
function localeFrom(ctx: ClientContext): AdLocaleFace | undefined {
  // cordis services live on a string-keyed registry; the locale plugin
  // registers under the key 'locale'. We can't import its augmentation
  // type in the standalone build, so the lookup is typed through unknown.
  const ctxAny = ctx as unknown as { get?: (key: string) => unknown }
  return ctxAny.get?.('locale') as AdLocaleFace | undefined
}

/** Optional rc.6 compatibility binder provided by dsh-web-settings; absent
 * when that group plugin is not installed, so callers fall back to the
 * official settings scope. (Mirror of dsh-pet's declaration-merge shape.) */
declare module '@deepseek-ai/cordis' {
  interface Context {
    webUiSettings?: { bind<S>(spec: SettingsScopeSpec<S>): SettingsScope<S> }
  }
}

/** Required services — boot fails to apply this plugin when any are missing. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote'] as const

/**
 * Browser plugin body: register the locales dictionary, mount a single
 * React root on `document.body` for the widget's lifetime, and register
 * the settings card as a first-level settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const locale = localeFrom(ctx)

  // Register the ad's locale dictionary. The shell routes any unknown
  // key through common first, then the owning namespace; without this
  // registration the settings card renders the key string itself
  // instead of a translated phrase. Mirrors dsh-pet's pattern.
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(NS, { zh, en })
      } catch {
        return () => {}
      }
    }, 'ad: dictionaries')
  }

  // Cross-instance single-mount guard (mirrors dsh-pet): a hot-reload or a
  // bundle re-injection must not leave a stale React root + container behind,
  // so sweep any existing root, then claim the body slot.
  for (const stale of Array.from(document.querySelectorAll('div[data-dsh-ad-root]'))) {
    stale.remove()
  }

  const container = document.createElement('div')
  container.dataset.dshAdRoot = ''
  container.dataset.dshPlugin = 'ad'
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  root.render(createElement(AdWidget))

  // Settings page registration. The binder comes from `ctx.get('webUiSettings')`
  // (legacy rc.6 compatibility) with a fallback to the runtime's official
  // `ctx.settingsScope`. The controller owns the card's staged form and its
  // source-choices list; unregistering the slot releases both via dispose().
  try {
    const binder = ctx.get('webUiSettings') ?? ctx.settingsScope
    const settingsScope = binder.bind<AdSettings>({ namespace: AD_SETTINGS_NS })
    const controller = new AdSettingsCardController(settingsScope)
    ctx.slots.inject('settings.section', () => {
      try {
        const unregister = ctx.slots.register({
          name: 'settings.section',
          id: 'ad',
          order: 120,
          label: () => (locale !== undefined ? locale.bind(NS)('settings.title') : 'Ads'),
          locale: NS,
          inject: () => controller.inject() as AdSettingsCardFace,
        }, AdSettingsSection)
        return () => {
          unregister()
          controller.dispose()
        }
      } catch {
        return () => {}
      }
    })
  } catch {
    // Settings UI unavailable; the widget itself is unaffected.
  }

  ctx.effect(
    () => () => {
      root.unmount()
      container.remove()
    },
    'ad: client lifecycle',
  )
}
