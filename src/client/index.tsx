/**
 * dsh-ad browser half — mounts the ad widget as a global floating surface,
 * the same way dsh-pet mounts its sprite: directly onto `document.body` via
 * a single React root, so it survives session/route changes instead of
 * living inside a session-scoped dock slot. The host settings toggle
 * (`ad.visible` / `ad.enabled`) controls whether the widget has any content
 * to show, not whether the root itself exists.
 *
 * Also registers a first-level settings page under the 'ad' slot, so the
 * dsh Settings sidebar shows an «Ad» entry next to «Pet» (Pet-style
 * settings card: enabled/visible/decoration toggles, size + right/bottom
 * insets, source picker).
 * @module dsh_plugin_ad/client
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AdWidget } from './AdWidget.tsx'
import { AdSettingsCardController, AdSettingsSection, type AdSettings, type AdSettingsCardFace } from './AdSettingsCard.tsx'

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
 * Best-effort shape of the client context's settings surface. The
 * dsh-client-runtime ships a richer type under
 * `@deepseek-ai/dsh-client-ui-settings/client`; we don't import it to
 * keep the build self-contained, but we type-check what we touch.
 */
interface SettingsSurface {
  bind<T>(opts: { namespace: string }): unknown
}
interface SlotsSurface {
  inject(slot: string, fn: () => () => void): void
  register(entry: SlotEntry, render: SlotRender): () => void
}
interface SlotEntry {
  name: string
  id: string
  order: number
  label: () => string
  locale: string
  inject: () => AdSettingsCardFace
}
type SlotRender = (props: {
  t: (k: string) => string
  useAdSettingsCard: <S,>(sel: (s: S) => S) => S
  save: () => void
  discard: () => void
  edit: (f: string, t: string) => void
  resetField: (f: string) => void
}) => React.ReactNode

/**
 * Browser plugin body: register the locales dictionary, mount a single
 * React root on `document.body` for the widget's lifetime, and register
 * the settings card as a first-level settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
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

  // Settings page registration. The `binder` and `slots` APIs come from
  // the dsh-client-runtime (Pet uses the same pattern). If the runtime
  // doesn't expose them in this deployment, the section silently no-ops
  // — the widget still mounts and works.
  try {
    const ctxAny = ctx as unknown as {
      get?: (key: string) => unknown
      settingsScope?: SettingsSurface
      slots?: SlotsSurface
    }
    const binder = (ctxAny.get?.('webUiSettings') as SettingsSurface | undefined) ?? ctxAny.settingsScope
    if (binder !== undefined) {
      const scope = binder.bind<AdSettings>({ namespace: AD_SETTINGS_NS })
      const controller = new AdSettingsCardController(scope as ConstructorParameters<typeof AdSettingsCardController>[0])
      ctxAny.slots?.inject('settings.section', () => {
        try {
          const unregister = ctxAny.slots!.register({
            name: 'settings.section',
            id: 'ad',
            order: 120,
            label: () => 'Ad',
            locale: 'ad',
            inject: () => controller.inject(),
          }, AdSettingsSection as unknown as SlotRender)
          return () => {
            unregister()
            controller.dispose()
          }
        } catch {
          return () => {}
        }
      })
    }
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
