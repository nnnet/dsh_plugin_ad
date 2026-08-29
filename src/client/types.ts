/**
 * dsh-ad client — shared shape definitions for the browser half. The host
 * has the canonical `AdItem`/`AdMedia`/`AdPrice`/`AdCta`/`AdDetails` types
 * under `../adapter.ts`; the mirror here keeps the client bundle free of
 * host-only imports (no `cordis`, no `node:http`, no `fs`) so it can be
 * loaded in any browser-side runtime that the host page brings to it.
 * @module dsh_plugin_ad/client/types
 */

export interface AdMedia {
  kind: 'video' | 'gif' | 'image'
  url: string
  thumbnailUrl?: string
}

export interface AdPrice {
  amount: number
  currency: string
  originalAmount?: number
  discountPercent?: number
}

export interface AdCta {
  id: string
  label: string
  kind: 'buy' | 'cart' | 'link' | 'chat'
  url?: string
}

export interface AdDetails {
  description?: string
  specs?: Record<string, string>
}

/** One normalized ad item as the browser receives it (credential-free). */
export interface AdItemView {
  id: string
  type: 'video' | 'gif' | 'image' | 'text' | 'message' | 'product' | 'html' | 'card' | 'raw'
  title?: string
  body?: string
  mediaUrl?: string
  media?: AdMedia[]
  price?: AdPrice
  ctas?: AdCta[]
  details?: AdDetails
  clickUrl?: string
}

export interface SourceView {
  id: string
  name: string
  enabled: boolean
  contentTypes: string[]
  hasChat: boolean
  chatStreaming?: boolean
  eligible: boolean
  ineligibleReason?: 'frequency-cap' | 'targeting'
  campaignLabel?: string
  /** How many items the host currently has in rotation for this source. */
  itemCount: number
}

export interface CartLineView {
  itemId: string
  title?: string
  price?: { amount: number; currency: string }
  mediaUrl?: string
  qty: number
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AdRuntimeContext {
  locale?: string
  path?: string
  tags?: string[]
}

/** Mirrors the host `AdDisplaySettings` (Pet-style). */
export interface DisplayView {
  visible: boolean
  enabled: boolean
  decorationEnabled: boolean
  size: number
  right: number
  bottom: number
}

/** Response shape of `/api/ad/sources` — sources + current display settings. */
export interface SourcesResponse {
  sources: SourceView[]
  display: DisplayView
  enabled: boolean
  activeSourceId?: string
}
