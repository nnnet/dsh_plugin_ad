/**
 * Price display: current price, a struck-through original price, and a
 * discount badge when the item is on sale.
 * @module @linxin666/dsh-ad/client/PriceTag
 */

import type { AdPrice } from './AdWidget.tsx'
import { t } from './locales.ts'
import styles from './ad.module.css'

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function PriceTag({ price }: { price: AdPrice }): React.ReactElement {
  const showOriginal = price.originalAmount !== undefined && price.originalAmount > price.amount

  return (
    <div className={styles.priceRow}>
      <span className={styles.priceCurrent}>
        {price.amount === 0 ? t('ad.product.priceFree') : formatMoney(price.amount, price.currency)}
      </span>
      {showOriginal && (
        <span className={styles.priceOriginal}>{formatMoney(price.originalAmount!, price.currency)}</span>
      )}
      {price.discountPercent !== undefined && price.discountPercent > 0 && (
        <span className={styles.discountBadge}>{t('ad.product.discount', { percent: price.discountPercent })}</span>
      )}
    </div>
  )
}
