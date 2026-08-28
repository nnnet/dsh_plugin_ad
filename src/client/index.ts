/**
 * dsh-ad browser half — mounts the ad widget as a global floating surface,
 * the same way dsh-pet mounts its sprite: directly onto `document.body` via
 * a single React root, so it survives session/route changes instead of
 * living inside a session-scoped dock slot.
 * @module @linxin666/dsh-ad/client
 */

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AdWidget } from './AdWidget.tsx'

export { AdWidget } from './AdWidget.tsx'
export type { AdItemView } from './AdWidget.tsx'
export { NS, en, zh, t, dictionary } from './locales.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined

/** Mount the ad widget once per page load. Safe to call multiple times. */
export function mountAdWidget(): void {
  if (root !== undefined) return
  container = document.createElement('div')
  container.id = 'dsh-ad-widget-root'
  document.body.appendChild(container)
  root = createRoot(container)
  root.render(createElement(AdWidget))
}

/** Tear down the widget (e.g. when the plugin is disabled at runtime). */
export function unmountAdWidget(): void {
  root?.unmount()
  container?.remove()
  root = undefined
  container = undefined
}

// Auto-mount on import, matching dsh-pet's client bootstrap behavior; the
// host settings toggle (`ad.visible` / `ad.enabled`) controls whether the
// widget has any content to show, not whether the root itself exists.
mountAdWidget()
