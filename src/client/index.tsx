/**
 * dsh-ad browser half — mounts the ad widget as a global floating surface,
 * the same way dsh-pet mounts its sprite: directly onto `document.body` via
 * a single React root, so it survives session/route changes instead of
 * living inside a session-scoped dock slot. The host settings toggle
 * (`ad.visible` / `ad.enabled`) controls whether the widget has any content
 * to show, not whether the root itself exists.
 * @module dsh_plugin_ad/client
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AdWidget } from './AdWidget.tsx'

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

/** Settings namespace the ad settings card edits (matches host plugin). */
const AD_SETTINGS_NS = 'ad'

/**
 * Browser plugin body: register the locales dictionary, then mount a single
 * React root on `document.body` for the lifetime of the page. Toggling the
 * host setting off hides the widget contents but keeps the root alive, so a
 * later re-enable skips remounting.
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

  ctx.effect(
    () => () => {
      root.unmount()
      container.remove()
    },
    'ad: client lifecycle',
  )
}
