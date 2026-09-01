/**
 * The "simple" (non-product) creative renderer: a single video/gif/image
 * with a click-through, or a text/message card. The original v0.1 widget
 * rendered only this shape; the marketplace renderer was added in v0.2.
 * The two are kept in separate files so neither inherits the other's
 * imports.
 * @module dsh_plugin_ad/client/SimpleCreative
 */

import type { MutableRefObject } from 'react'
import type { AdItemView } from './types.ts'
import { t } from './locales.ts'
import styles from './ad.module.css'

function openClickThrough(url: string | undefined): void {
  if (url === undefined || url === '') return
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function SimpleCreative({ item, suppressClickRef, onClick: onClickProp, onVideoError: onVideoErrorProp, onVideoLoadedMetadata }: {
  item: AdItemView
  /**
   * Set by the parent widget while a drag gesture is in progress. Every
   * click-through path here swallows the click if the gesture was a
   * real drag — otherwise a browser-synthesised `click` fired right
   * after `pointerup` would route the user's drag straight into the
   * ad's landing page. The root `<div>` already checks this flag; we
   * check it here too because the click target is the creative element
   * (`<img>`, `<video>`, or a text card), not the root.
   */
  suppressClickRef?: MutableRefObject<boolean>
  onClick?: () => void
  /** Called once when the <video> element fires an `error` event
   *  (network/CORS/decode failure). The parent uses this to swap in a
   *  fallback message instead of leaving a black box. */
  onVideoError?: () => void
  /**
   * Called when the <video> element fires `loadedmetadata`. The
   * argument is the raw clip duration in milliseconds (already
   * multiplied from `<video>.duration` in seconds). The parent uses
   * this to refine the rotation timer to the clip's real length
   * via `clampDurationMs`. The callback is sync; it's called on
   * every `loadedmetadata` (which is once per load in practice), and
   * the parent is responsible for de-duplicating if needed.
   */
  onVideoLoadedMetadata?: (durationMs: number) => void
}): React.ReactElement {
  const clickable = item.clickUrl !== undefined && item.clickUrl !== ''
  const onClick = (): void => {
    if (suppressClickRef?.current === true) return
    if (onClickProp !== undefined) { onClickProp(); return }
    openClickThrough(item.clickUrl)
  }

  const stopAndMaybeClick = (e: React.MouseEvent): void => {
    // Stop propagation so the parent widget's onClick (which is the
    // click-through fallback for clicks on empty surface) doesn't
    // double-fire and open two tabs.
    e.stopPropagation()
    if (suppressClickRef?.current === true) return
    if (clickable) onClick()
  }

  switch (item.type) {
    case 'video':
      return (
        <video
          className={styles.media}
          src={item.mediaUrl}
          autoPlay
          muted
          loop
          playsInline
          onClick={stopAndMaybeClick}
          title={clickable ? t('ad.widget.clickHint') : undefined}
          onError={onVideoErrorProp}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (Number.isFinite(v.duration) && v.duration > 0) {
              onVideoLoadedMetadata?.(v.duration * 1000)
            }
          }}
        />
      )
    case 'gif':
    case 'image':
      return (
        <img
          className={styles.media}
          src={item.mediaUrl}
          alt={item.title ?? ''}
          onClick={stopAndMaybeClick}
          title={clickable ? t('ad.widget.clickHint') : undefined}
        />
      )
    case 'html':
      return (
        <div
          className={styles.htmlCard}
          onClick={stopAndMaybeClick}
          dangerouslySetInnerHTML={item.body !== undefined ? { __html: item.body } : undefined}
        />
      )
    case 'card':
    case 'message':
    case 'text':
    case 'raw':
    default:
      return (
        <div className={styles.textCard} onClick={stopAndMaybeClick}>
          {item.title !== undefined && <div className={styles.textTitle}>{item.title}</div>}
          {item.body !== undefined && <div className={styles.textBody}>{item.body}</div>}
        </div>
      )
  }
}
