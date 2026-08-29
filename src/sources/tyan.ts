/**
 * dsh-ad — built-in tyan.ai avatar-video source preset.
 *
 * A static, no-poll source: a fixed list of mp4 avatars served from
 * `static.tyan.ai/avatars`. The widget rotates through them as `type:
 * 'video'` creatives, each rendered as a muted-autoplay HTML5 video.
 * Click-through lands on the tyan.ai root.
 *
 * Static-list sources use the `staticItems` field on `AdSourceConfig`
 * (no `feed`, no polling, no credentials). The host seeds the cache
 * once on mount; the widget iterates it like any other source.
 *
 * ## API
 *
 * Video URLs (as of 2026-08-29):
 *   - https://static.tyan.ai/avatars/0643e8b9d9a1eedd0e3eb0f220429bdf59e4a0f3.mp4
 *   - https://static.tyan.ai/avatars/3d9dff10fe3d30660389d15b6d0e78eb5f1a7090.mp4
 *
 * Both hosts (`static.tyan.ai`, `tyan.ai`) are added to the `allowHosts`
 * list automatically. The source requires no auth.
 * @module dsh_plugin_ad/sources/tyan
 */

import type { AdSourceConfig } from '../config.ts'
import type { AdItem } from '../adapter.ts'

/** Built-in URL list (the first URL is duplicated in the user's request;
 * kept as-is because the user wanted exactly that list). */
const DEFAULT_VIDEOS: ReadonlyArray<{ url: string; title: string }> = [
  { url: 'https://static.tyan.ai/avatars/0643e8b9d9a1eedd0e3eb0f220429bdf59e4a0f3.mp4', title: 'Tyan avatar 0643…0f3' },
  { url: 'https://static.tyan.ai/avatars/3d9dff10fe3d30660389d15b6d0e78eb5f1a7090.mp4', title: 'Tyan avatar 3d9d…090' },
  { url: 'https://static.tyan.ai/avatars/0643e8b9d9a1eedd0e3eb0f220429bdf59e4a0f3.mp4', title: 'Tyan avatar 0643…0f3 (B)' },
]

/** Build a tyan.ai video source config ready to drop into `sources[]`. */
export interface TyanVideosOptions {
  /** Override the source id; default `'tyan-videos'`. */
  id?: string
  /** Override the display name; default `'Tyan Videos'`. */
  name?: string
  /** Custom video list; defaults to the three built-in URLs. */
  videos?: ReadonlyArray<{ url: string; title?: string }>
  /** Click-through URL for every item. Default `https://tyan.ai`. */
  clickThroughUrl?: string
  /** Disable the source without removing it from config. */
  enabled?: boolean
  /** Max items the host will keep in rotation (default: as many as supplied). */
  maxItems?: number
}

export function buildTyanVideosSource(opts: TyanVideosOptions = {}): AdSourceConfig {
  const id = opts.id ?? 'tyan-videos'
  const name = opts.name ?? 'Tyan Videos'
  const videos = opts.videos ?? DEFAULT_VIDEOS
  const clickThroughUrl = opts.clickThroughUrl ?? 'https://tyan.ai'

  const staticItems: AdItem[] = videos.map((v, i) => ({
    id: `${id}#${i}`,
    type: 'video',
    title: v.title ?? `Video ${i + 1}`,
    mediaUrl: v.url,
    media: [{ kind: 'video', url: v.url }],
    clickUrl: clickThroughUrl,
  }))

  return {
    id,
    name,
    enabled: opts.enabled ?? true,
    contentTypes: ['video'],
    allowHosts: ['static.tyan.ai', 'tyan.ai'],
    allowPrivateNetwork: false,
    maxItems: opts.maxItems ?? videos.length,
    staticItems,
    clickThroughUrl,
    campaign: {
      id: 'tyan-avatar-rotator',
      placement: 'dsh-ad',
      priority: 50,
      weight: 5,
    },
  }
}
