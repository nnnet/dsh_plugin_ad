/**
 * Row of call-to-action buttons on a product card. 'buy' and 'link' open
 * the ad's click-through (or the CTA's own URL if it has one); 'cart' adds
 * the item to the local cart mirror; 'chat' opens the assistant panel.
 * Every label falls back to a locale default for its kind, so a feed that
 * omits `label` still renders something sensible.
 * @module dsh_plugin_ad/client/CtaRow
 */

import type { MutableRefObject } from 'react'
import type { AdCta } from './types.ts'
import { t } from './locales.ts'
import styles from './ad.module.css'

const DEFAULT_LABEL_KEY: Record<AdCta['kind'], string> = {
  buy: 'ad.cta.buy',
  cart: 'ad.cta.cart',
  link: 'ad.cta.link',
  chat: 'ad.cta.chat',
}

export function CtaRow({
  ctas,
  fallbackUrl,
  suppressClickRef,
  onBuyOrLink,
  onAddToCart,
  onOpenChat,
}: {
  ctas: AdCta[]
  fallbackUrl: string | undefined
  /**
   * Set by the parent widget while a drag gesture is in progress. CTA
   * clicks are swallowed if the gesture was a real drag — the trailing
   * browser-synthesised `click` after `pointerup` would otherwise route
   * straight into the ad's landing page. Without this guard, a CTA
   * press-drag-release opens the destination in a new tab.
   */
  suppressClickRef?: MutableRefObject<boolean>
  onBuyOrLink: (url: string | undefined) => void
  onAddToCart: () => void
  onOpenChat: () => void
}): React.ReactElement {
  return (
    <div className={styles.ctaRow}>
      {ctas.map((cta) => {
        const label = cta.label !== '' ? cta.label : t(DEFAULT_LABEL_KEY[cta.kind])
        const variant = cta.kind === 'buy' ? styles.ctaPrimary : styles.ctaSecondary
        const onClick = (): void => {
          if (suppressClickRef?.current === true) return
          if (cta.kind === 'cart') onAddToCart()
          else if (cta.kind === 'chat') onOpenChat()
          else onBuyOrLink(cta.url ?? fallbackUrl)
        }
        return (
          <button
            key={cta.id}
            className={`${styles.ctaButton} ${variant}`}
            onClick={(e) => { e.stopPropagation(); onClick() }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
