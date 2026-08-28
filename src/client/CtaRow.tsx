/**
 * Row of call-to-action buttons on a product card. 'buy' and 'link' open
 * the ad's click-through (or the CTA's own URL if it has one); 'cart' adds
 * the item to the local cart mirror; 'chat' opens the assistant panel.
 * Every label falls back to a locale default for its kind, so a feed that
 * omits `label` still renders something sensible.
 * @module @linxin666/dsh-ad/client/CtaRow
 */

import type { AdCta } from './AdWidget.tsx'
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
  onBuyOrLink,
  onAddToCart,
  onOpenChat,
}: {
  ctas: AdCta[]
  fallbackUrl: string | undefined
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
          if (cta.kind === 'cart') onAddToCart()
          else if (cta.kind === 'chat') onOpenChat()
          else onBuyOrLink(cta.url ?? fallbackUrl)
        }
        return (
          <button key={cta.id} className={`${styles.ctaButton} ${variant}`} onClick={onClick}>
            {label}
          </button>
        )
      })}
    </div>
  )
}
