/**
 * dsh-ad marketplace renderer — the full "product card" view the widget
 * uses when an item is recognized as a marketplace product (has price,
 * media carousel, CTAs, expandable details, and an optional chat panel).
 *
 * It composes the smaller `ProductCarousel`, `PriceTag`, `CtaRow`, and
 * `ProductDetails` components and keeps the same `AdItemView` contract as
 * the simpler `SimpleCreative` renderer, so the widget can swap renderers
 * without touching the data layer.
 *
 * The marketplace renderer adds nothing source-specific: an item with the
 * same `media`/`price`/`ctas`/`details` shape is rendered the same way no
 * matter whether it came from a CS:GO skin marketplace, a fashion outlet,
 * or a coffee subscription feed.
 * @module dsh_plugin_ad/client/MarketplaceRenderer
 */

import type { MutableRefObject } from 'react'
import type { AdItemView } from './types.ts'
import { ProductCarousel } from './ProductCarousel.tsx'
import { PriceTag } from './PriceTag.tsx'
import { CtaRow } from './CtaRow.tsx'
import { ProductDetails } from './ProductDetails.tsx'
import { t } from './locales.ts'
import styles from './ad.module.css'

/** Open a click-through URL the way a normal outbound ad link would. */
function openClickThrough(url: string | undefined): void {
  if (url === undefined || url === '') return
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function MarketplaceRenderer({
  item,
  campaignLabel,
  suppressClickRef,
  onAddToCart,
  onOpenChat,
  onClickThrough,
}: {
  item: AdItemView
  /** Optional source-level campaign label, shown as a small badge in the corner. */
  campaignLabel?: string
  /**
   * Set by the parent widget while a drag gesture is in progress. Every
   * click-through path here checks it before opening the destination —
   * otherwise a browser-synthesised `click` fired immediately after
   * `pointerup` would route the user's drag straight into the ad's
   * landing page (or any other outbound URL the renderer triggers).
   * Without this, a real drag >6 px still ends in a new tab opening
   * because the click target is a child element (`<img>`, `<video>`, a
   * CTA button), not the root `<div>` whose `onClick` swallows the
   * gesture.
   */
  suppressClickRef?: MutableRefObject<boolean>
  onAddToCart: (item: AdItemView) => void
  onOpenChat: () => void
  /**
   * Optional widget-level click-through. When provided, the carousel
   * activation prefers this handler (so the widget can run its own
   * impression/click beacon before opening the destination).
   */
  onClickThrough?: () => void
}): React.ReactElement {
  const wasDragged = (): boolean => suppressClickRef?.current === true
  const activate = (): void => {
    if (wasDragged()) return
    if (onClickThrough !== undefined) { onClickThrough(); return }
    openClickThrough(item.clickUrl)
  }
  return (
    <div className={styles.productCard} data-renderer="marketplace">
      {campaignLabel !== undefined && (
        <div className={styles.campaignBadge} title={campaignLabel}>
          {campaignLabel}
        </div>
      )}
      {item.media !== undefined && item.media.length > 0 && (
        <ProductCarousel
          media={item.media}
          countLabel={t('ad.product.galleryCount', { count: item.media.length })}
          suppressClickRef={suppressClickRef}
          onActivate={activate}
        />
      )}
      <div className={styles.productBody}>
        {item.title !== undefined && <div className={styles.productTitle}>{item.title}</div>}
        {item.body !== undefined && <div className={styles.productSummary}>{item.body}</div>}
        {item.price !== undefined && <PriceTag price={item.price} />}
        {item.details !== undefined && <ProductDetails details={item.details} />}
        {item.ctas !== undefined && item.ctas.length > 0 && (
          <CtaRow
            ctas={item.ctas}
            fallbackUrl={item.clickUrl}
            suppressClickRef={suppressClickRef}
            onBuyOrLink={openClickThrough}
            onAddToCart={() => { onAddToCart(item) }}
            onOpenChat={onOpenChat}
          />
        )}
      </div>
    </div>
  )
}
