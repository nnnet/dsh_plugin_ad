/**
 * Expandable description + spec table for a product card. Collapsed by
 * default so the card stays compact until the shopper asks for more.
 * @module dsh_plugin_ad/client/ProductDetails
 */

import { useState } from 'react'
import type { AdDetails } from './types.ts'
import { t } from './locales.ts'
import styles from './ad.module.css'

export function ProductDetails({ details }: { details: AdDetails }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const specs = details.specs !== undefined ? Object.entries(details.specs) : []

  return (
    <div className={styles.details}>
      <button className={styles.detailsToggle} onClick={() => { setOpen((v) => !v) }}>
        {t('ad.product.detailsToggle')} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className={styles.detailsBody}>
          {details.description !== undefined && <p className={styles.detailsDescription}>{details.description}</p>}
          {specs.length > 0 && (
            <>
              <div className={styles.detailsSpecsTitle}>{t('ad.product.specs')}</div>
              <table className={styles.specsTable}>
                <tbody>
                  {specs.map(([key, value]) => (
                    <tr key={key}>
                      <td className={styles.specKey}>{key}</td>
                      <td className={styles.specValue}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  )
}
