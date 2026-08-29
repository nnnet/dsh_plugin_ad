/**
 * The "simple" (non-product) creative renderer: a single video/gif/image
 * with a click-through, or a text/message card. The original v0.1 widget
 * rendered only this shape; the marketplace renderer was added in v0.2.
 * The two are kept in separate files so neither inherits the other's
 * imports.
 * @module dsh_plugin_ad/client/SimpleCreative
 */

import type { AdItemView } from './types.ts'
import { t } from './locales.ts'
import styles from './ad.module.css'

function openClickThrough(url: string | undefined): void {
  if (url === undefined || url === '') return
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function SimpleCreative({ item, onClick: onClickProp }: {
  item: AdItemView
  onClick?: () => void
}): React.ReactElement {
  const clickable = item.clickUrl !== undefined && item.clickUrl !== ''
  const onClick = (): void => {
    if (onClickProp !== undefined) { onClickProp(); return }
    openClickThrough(item.clickUrl)
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
          onClick={clickable ? onClick : undefined}
          title={clickable ? t('ad.widget.clickHint') : undefined}
        />
      )
    case 'gif':
    case 'image':
      return (
        <img
          className={styles.media}
          src={item.mediaUrl}
          alt={item.title ?? ''}
          onClick={clickable ? onClick : undefined}
          title={clickable ? t('ad.widget.clickHint') : undefined}
        />
      )
    case 'html':
      return (
        <div
          className={styles.htmlCard}
          onClick={clickable ? onClick : undefined}
          dangerouslySetInnerHTML={item.body !== undefined ? { __html: item.body } : undefined}
        />
      )
    case 'card':
    case 'message':
    case 'text':
    case 'raw':
    default:
      return (
        <div className={styles.textCard} onClick={clickable ? onClick : undefined}>
          {item.title !== undefined && <div className={styles.textTitle}>{item.title}</div>}
          {item.body !== undefined && <div className={styles.textBody}>{item.body}</div>}
        </div>
      )
  }
}
