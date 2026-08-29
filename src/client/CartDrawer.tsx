/**
 * Cart drawer: shows the local cart mirror (see host cart.ts) with per-line
 * quantity controls and a running total. Checkout itself is out of scope —
 * a 'buy' CTA (or the marketplace's own site) owns that — this is purely
 * "what has the shopper flagged interest in" during the session.
 * @module dsh_plugin_ad/client/CartDrawer
 */

import type { CartLineView } from './types.ts'
import { t } from './locales.ts'
import styles from './ad.module.css'

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function CartDrawer({
  lines,
  total,
  onQtyChange,
  onRemove,
  onClear,
}: {
  lines: CartLineView[]
  total: { amount: number; currency: string } | undefined
  onQtyChange: (itemId: string, qty: number) => void
  onRemove: (itemId: string) => void
  onClear: () => void
}): React.ReactElement {
  return (
    <div className={styles.cartDrawer}>
      <div className={styles.cartHeader}>
        <span>{t('ad.cart.title')}</span>
        {lines.length > 0 && <button className={styles.cartClear} onClick={onClear}>{t('ad.cart.clear')}</button>}
      </div>

      {lines.length === 0
        ? <div className={styles.cartEmpty}>{t('ad.cart.empty')}</div>
        : (
          <div className={styles.cartLines}>
            {lines.map((line) => (
              <div key={line.itemId} className={styles.cartLine}>
                {line.mediaUrl !== undefined && <img className={styles.cartThumb} src={line.mediaUrl} alt="" />}
                <div className={styles.cartLineInfo}>
                  <div className={styles.cartLineTitle}>{line.title ?? line.itemId}</div>
                  {line.price !== undefined && (
                    <div className={styles.cartLinePrice}>{formatMoney(line.price.amount, line.price.currency)}</div>
                  )}
                  <div className={styles.cartQtyRow}>
                    <label>{t('ad.cart.qty')}</label>
                    <input
                      type="number"
                      min={0}
                      className={styles.cartQtyInput}
                      value={line.qty}
                      onChange={(e) => { onQtyChange(line.itemId, Number(e.target.value)) }}
                    />
                    <button className={styles.cartRemove} onClick={() => { onRemove(line.itemId) }}>
                      {t('ad.cart.remove')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          )}

      {total !== undefined && (
        <div className={styles.cartTotal}>
          <span>{t('ad.cart.total')}</span>
          <span>{formatMoney(total.amount, total.currency)}</span>
        </div>
      )}
      <div className={styles.cartHint}>{t('ad.cart.checkoutHint')}</div>
    </div>
  )
}
