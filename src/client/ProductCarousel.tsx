/**
 * Media carousel for a product card: a stack of video/gif/image entries
 * with prev/next controls and a dot indicator. Each frame is only mounted
 * while active, so multiple `<video>` sources on one card don't all play
 * (or buffer) at once.
 * @module @linxin666/dsh-ad/client/ProductCarousel
 */

import { useState } from 'react'
import type { AdMedia } from './AdWidget.tsx'
import { t } from './locales.ts'
import styles from './ad.module.css'

export function ProductCarousel({ media, onActivate }: { media: AdMedia[]; onActivate: () => void }): React.ReactElement {
  const [index, setIndex] = useState(0)
  const current = media[Math.min(index, media.length - 1)]

  const go = (delta: number): void => {
    setIndex((i) => (i + delta + media.length) % media.length)
  }

  return (
    <div className={styles.carousel}>
      {current.kind === 'video'
        ? (
          <video
            className={styles.media}
            src={current.url}
            poster={current.thumbnailUrl}
            autoPlay
            muted
            loop
            playsInline
            onClick={onActivate}
          />
          )
        : (
          <img className={styles.media} src={current.url} alt="" onClick={onActivate} />
          )}

      {media.length > 1 && (
        <>
          <button
            className={`${styles.carouselNav} ${styles.carouselPrev}`}
            aria-label={t('ad.product.mediaPrev')}
            onClick={(e) => { e.stopPropagation(); go(-1) }}
          >
            ‹
          </button>
          <button
            className={`${styles.carouselNav} ${styles.carouselNext}`}
            aria-label={t('ad.product.mediaNext')}
            onClick={(e) => { e.stopPropagation(); go(1) }}
          >
            ›
          </button>
          <div className={styles.carouselDots}>
            {media.map((m, i) => (
              <span
                key={`${m.url}-${i}`}
                className={i === index ? styles.dotActive : styles.dot}
                onClick={(e) => { e.stopPropagation(); setIndex(i) }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
