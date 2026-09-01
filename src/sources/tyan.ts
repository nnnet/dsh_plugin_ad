/**
 * dsh-ad — built-in tyan.ai avatar-video source preset.
 *
 * A static, no-poll source: a curated list of mp4 avatars served from
 * `static.tyan.ai/avatars`, each paired with the matching messenger page
 * on tyan.ai. The widget rotates through them as `type: 'video'`
 * creatives, each rendered as a muted-autoplay HTML5 video; clicking the
 * widget opens the per-avatar messenger page (not the tyan.ai root).
 *
 * Static-list sources use the `staticItems` field on `AdSourceConfig`
 * (no `feed`, no polling, no credentials). The host seeds the cache
 * once on mount; the widget iterates it like any other source.
 *
 * ## Avatar list
 *
 * Each entry is `(mp4 URL, messenger URL, name)`. Both hosts
 * (`static.tyan.ai`, `tyan.ai`) are added to the `allowHosts` list
 * automatically. The source requires no auth.
 *
 * List as of 2026-08-31 (extracted via Playwright from tyan.ai/en/ — the
 * homepage's <video> elements each point at a per-character mp4, and
 * the wrapping <a> points at the matching /en/messenger?id=… page).
 * @module dsh_plugin_ad/sources/tyan
 */

import type { AdSourceConfig } from '../config.ts'
import type { AdItem } from '../adapter.ts'

/** One avatar: its avatar-preview mp4, its messenger page URL, and a label. */
export interface TyanAvatar {
  url: string
  pageUrl: string
  title: string
}

/** Built-in avatar list, scraped from tyan.ai/en/ on 2026-08-31.
 * Each entry is the (mp4, messenger id, name) pair as it appears in the
 * homepage `<a href="/en/messenger?id=…">` card that wraps the per-avatar
 * `<video src="https://static.tyan.ai/avatars/<hash>.mp4">`. Order matches
 * the on-page rotation. The list is deduped by mp4 URL — duplicates seen
 * on the homepage collapse to the first occurrence. */
const DEFAULT_AVATARS: ReadonlyArray<TyanAvatar> = dedup([
  { url: 'https://static.tyan.ai/avatars/3d9dff10fe3d30660389d15b6d0e78eb5f1a7090.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=28979', title: 'Emily, 18' },
  { url: 'https://static.tyan.ai/avatars/194340df7cbdfcb009eccb616b118623df96f66c.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=23706', title: 'Nikki, 20' },
  { url: 'https://static.tyan.ai/avatars/78f87499497cd6c47d26c75ce974f13647ead933.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=22270', title: 'Bella Mur, 27' },
  { url: 'https://static.tyan.ai/avatars/19a200f5e50a912e4e7cf731a237dfc144d01e00.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=22243', title: 'Piper, 29' },
  { url: 'https://static.tyan.ai/avatars/e985c101f07888afef2a1040f17a7f2fd8406713.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=16359', title: 'Mimi, 18' },
  { url: 'https://static.tyan.ai/avatars/beb3a1de7c9f92593adb6f08486858ef7d26a820.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=19151', title: 'Lora, 25' },
  { url: 'https://static.tyan.ai/avatars/8ecb0e6072b8bd8765e69e7e9b43c75043e9cef7.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=1657', title: 'Isabella, 24' },
  { url: 'https://static.tyan.ai/avatars/d719c3173cf96652f3130aa9a3cc7f43549f5720.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=21035', title: 'Kitty, 18' },
  { url: 'https://static.tyan.ai/avatars/67173f1d1989ac3905212f96caf1c3d5800680f0.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=4983', title: 'Jolie, 45' },
  { url: 'https://static.tyan.ai/avatars/61a5068b6ac83d0fc4b69eae8456b5a5364d284f.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=33', title: 'Poppy, 18' },
  { url: 'https://static.tyan.ai/avatars/162a72abd642c330e6a69e3d73090a3c77d42fb8.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=19509', title: 'Hannah, 18' },
  { url: 'https://static.tyan.ai/avatars/7f94e7d74664af52a3fd768dbe2ed9d25fe2297b.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=20327', title: 'Sirin, 19' },
  { url: 'https://static.tyan.ai/avatars/461a973fc119e059b0e6f6b0306a45968aef7e96.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=13780', title: 'Fatima, 26' },
  { url: 'https://static.tyan.ai/avatars/372b83cb729a837ee69dcb40f54925d80a283fb8.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=13796', title: 'Sindy, 18' },
  { url: 'https://static.tyan.ai/avatars/cc689e4d47a1fd9e778c7384946c5c6f62550ea9.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=16988', title: 'Tiffany, 32' },
  { url: 'https://static.tyan.ai/avatars/b56ee41bc05aae178c3644350ebb6917bab9d405.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=19082', title: 'Kwini Kim, 20' },
  { url: 'https://static.tyan.ai/avatars/e8d8fe931c3aa53cf2cff6317c20679edca7f23a.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=2354', title: 'Mia, 20' },
  { url: 'https://static.tyan.ai/avatars/3ea982c93bf34f781f3199afc54b5f9c8f7863d9.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=19083', title: 'Milka Way, 22' },
  { url: 'https://static.tyan.ai/avatars/0fc7978108e433781073e0fda87b2f15586065fb.mp4', pageUrl: 'https://tyan.ai/en/messenger?id=5211', title: 'Sally, 38' },
])

function dedup<T extends { url: string }>(items: ReadonlyArray<T>): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    if (seen.has(it.url)) continue
    seen.add(it.url)
    out.push(it)
  }
  return out
}

/** Build a tyan.ai video source config ready to drop into `sources[]`. */
export interface TyanVideosOptions {
  /** Override the source id; default `'tyan-videos'`. */
  id?: string
  /** Override the display name; default `'Tyan Avatars'`. */
  name?: string
  /** Custom avatar list; defaults to the curated 19 built-in entries. */
  avatars?: ReadonlyArray<TyanAvatar>
  /** Final-fallback click-through URL, used only when an avatar has
   *  no per-item `pageUrl` and `service.resolveClickThrough` has
   *  nothing to prefer. Per-item `pageUrl` always wins; this is the
   *  landing page for the rare "no messenger id" case. */
  fallbackClickUrl?: string
  /** Disable the source without removing it from config. */
  enabled?: boolean
  /** Max items the host will keep in rotation (default: as many as supplied). */
  maxItems?: number
}

export function buildTyanVideosSource(opts: TyanVideosOptions = {}): AdSourceConfig {
  const id = opts.id ?? 'tyan-videos'
  const name = opts.name ?? 'Tyan Avatars'
  const avatars = opts.avatars ?? DEFAULT_AVATARS
  const fallbackClickUrl = opts.fallbackClickUrl ?? 'https://tyan.ai'

  const staticItems: AdItem[] = avatars.map((a, i) => ({
    id: `${id}#${i}`,
    type: 'video',
    title: a.title,
    body: a.pageUrl,
    mediaUrl: a.url,
    media: [{ kind: 'video', url: a.url }],
    clickUrl: a.pageUrl,
  }))

  return {
    id,
    name,
    enabled: opts.enabled ?? true,
    contentTypes: ['video'],
    allowHosts: ['static.tyan.ai', 'tyan.ai'],
    allowPrivateNetwork: false,
    maxItems: opts.maxItems ?? avatars.length,
    staticItems,
    clickThroughUrl: fallbackClickUrl,
    campaign: {
      id: 'tyan-avatar-rotator',
      placement: 'dsh-ad',
      priority: 50,
      weight: 5,
    },
  }
}
