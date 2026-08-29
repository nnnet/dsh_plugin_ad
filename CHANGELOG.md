# Changelog

All notable changes to `dsh_plugin_ad` are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

## 0.3.0 — Source actions, tracking, and the CS:GO preset (Phase 3)

### Added
- **`AdActionConfig` and `actions[]` on the source** — a list of named
  actions the browser can invoke on the source (`details`, `addToCart`,
  `checkout`, vendor-specific calls). Each action has its own endpoint,
  optional credentials (falls back to the source's `auth`), and an
  `autoInvoke` flag for non-user-gated calls. New route:
  `POST /api/ad/action` (`{ sourceId, actionId, payload }`) runs the
  configured endpoint server-side.
- **Tracking API** — `POST /api/ad/track` accepts
  `{ sourceId, event, payload }` and forwards to the source's
  `tracking.impressionUrl` / `tracking.clickUrl` /
  `tracking.conversionUrl`. The widget now also POSTs
  `/api/ad/impression` every time it shows a new item, and
  `/api/ad/click` automatically fires a click beacon alongside its
  existing idempotent reply. Failure to reach the tracker never blocks
  rotation or the user's click-through.
- **`AdService.track(event, payload)`** — explicit host-side tracking
  method for callers that want to forward events from their own
  middleware.
- **CS:GO Market source preset** (`src/sources/csgo.ts`):
  `buildCsgoMarketSource({ currency, imageWidth, loginEnv, passwordEnv,
  frequencyCap, targetingPaths, targetingLocales, id, name })` returns
  a ready-to-use `AdSourceConfig` with the right feed URL
  (`https://market.csgo.com/api/v2/prices/<CCY>.json`), the cdn2.csgo.com
  image CDN host allowlisted, `__HASH_NAME__` / `__PRICE__` /
  `__BASE__` mapping sentinels wired up, default frequency cap
  (5 / 10 min), and a campaign entry. Useful for tools that want to
  inject the source at runtime.
- **Image URL templates** (`src/sources/image-templates.ts`):
  `csgoImageUrl(hashName, width)`, `steamImageUrl(iconUrl)`,
  `steamListingUrl(appId, hashName)`, `dotaPriceFeedUrl(currency)`,
  `dotaImageUrl(hashName, width)`. The adapter doesn't import these
  (it stays source-agnostic); they're a convenience for source
  adapters and the marketplace renderer.
- **Adapter sentinels for flat-map feeds**:
  - `mapping.id: "__HASH_NAME__"` — use the entry's own top-level key.
  - `mapping.priceAmount: "__PRICE__"` — use the entry's own value.
  - `mapping.imageBaseUrl: "__BASE__"` — synthesize the
    `cdn2.csgo.com` webp URL via `extra.__csgoImageWidth`.
  The adapter auto-detects the flat-map shape and rebuilds each entry
  into `{ [hash_name]: price }` so the sentinels resolve.
- **AdSourceView.actions** — the credential-free list now includes the
  source's action ids, so the widget can offer action buttons without
  re-fetching config.
- **Impression beacon in the widget** — every successful
  `/api/ad/next` triggers a `POST /api/ad/impression` (best-effort,
  swallowed on failure).
- **Tests** for the new modules: `test/sources.test.ts` (image URL
  templates + CS:GO preset) and `test/adapter.test.ts` (flat-map
  detection, cdn2.csgo.com URL synthesis, standard marketplace record
  normalization).
- **README** updated to document the CS:GO preset and the new action /
  tracking routes.

## 0.2.1 — Marketplace renderer polish (Phase 2)

### Added
- **`src/marketplace-renderer.ts`** — explicit marketplace-renderer
  helpers that vendor adapters can call instead of the generic
  `normalizeAdItem` when the feed has marketplace-specific fields:
  - `readMarketplaceExtras` — pulls `sku`, `productId`, `brand`,
    `rating`, `inStock`, `overrideClickUrl` from common field names
    (with snake_case fallbacks).
  - `normalizeMarketplaceItem` — forces the result type to `product`
    and applies the source's `mapping` overrides.
  - `defaultCtas` / `defaultDetails` — build a buy + cart row and a
    specs table from extras when the feed didn't supply them.
  - `formatPriceLabel` — single-line price label ("Free" for 0,
    `Intl.NumberFormat` for the rest).
  - `campaignLabel` — combines the source's `campaign.placement` (or
    `campaign.id`) with `priority` / `weight` for the widget's source
    picker badge.
  - `absolutizeMedia` / `firstMediaUrl` — URL/array helpers used by
    cart thumbnails and feed-specific adapters.
- **Campaign badge in the widget** — the `MarketplaceRenderer` shows a
  small translucent pill with the source's `campaignLabel` (when set)
  in the top-left corner of the product card. Surfaced to the client
  through the new `AdSourceView.campaignLabel` field.
- **`test/marketplace-renderer.test.ts`** — unit tests for the new
  helpers: extras extraction, mapping overrides, item-level click
  overrides, price formatting, default CTA / details builders,
  campaign label composition, media URL absolutization, and the
  `firstMediaUrl` helper.

## 0.2.0 — Marketplace renderer + extracted constants

### Added
- **Marketplace renderer** (`src/client/MarketplaceRenderer.tsx`): full
  product card with a multi-asset media carousel, price/discount tag,
  CTA-button row, expandable product details (description + spec table),
  cart drawer, and an AI-assistant chat panel that streams tokens live.
  The renderer is chosen automatically when the normalized `AdItem.type`
  is `product`; everything else renders through the existing simple
  creative path.
- **`AdContentType` extended** with `html`, `card`, and `raw` to make room
  for non-product feeds without abandoning the same `AdItem` contract.
- **`AdSourceConfig` security & lifecycle controls** (v0.3 surfaced in
  this drop):
  - `allowHosts` — per-source outbound host allowlist.
  - `allowPrivateNetwork` — opt-in for RFC1918 / loopback targets.
  - `maxResponseBytes` — hard cap on every response body (chat + feed +
    streamed).
  - `frequencyCap` — per-source rolling impression counter
    (`{ maxImpressions, windowMs }`).
  - `targeting` — `locales` / `paths` / `tags` plus matching
    `excludePaths` / `excludeTags`. Eligibility is checked on every
    `nextItem()` call.
  - `campaign` — opaque `id` / `placement` / `priority` / `weight`
    surfaced to the client for impression/click telemetry.
  - `mapping` — explicit per-field dot paths for feeds that don't match
    the built-in normalizer.
  - `tracking` — per-source impression/click/conversion endpoints.
- **`loadConfigFromFile`** — when `config.configFile` (or the env var
  `DSH_AD_CONFIG`) points at a JSON file, its contents are shallow-merged
  under the inline config (inline wins). Sources with the same `id` are
  merged per-field, so the file can ship "defaults" while the inline
  config patches specific entries.
- **New constants module** (`src/constants.ts`) with all numeric/path
  limits in one place; `routes.ts`, `http.ts`, and `client/constants.ts`
  pull from it.
- **New messages module** (`src/messages.ts`) with every host-side
  diagnostic string in one place; `routes.ts` and `service.ts` pull from
  it. UI copy is still in `src/locales/*` / `src/client/locales/*`.
- **Chinese copy** (`src/locales/zh.ts` + `src/client/locales/zh.ts`) for
  every host and widget key, mirroring the English dictionaries.
- **CS:GO example** in `example.config.yaml` pointed at
  `https://market.csgo.com/api/v2/prices/RUB.json` and the
  `cdn2.csgo.com` image CDN, with env-var credentials
  (`CSGO_LOGIN` / `CSGO_PASSWORD`), host allowlist, size cap, frequency
  cap, and targeting.
- **Mapping override example** in the same CS:GO config: each feed
  record's `hash_name` becomes the item id, `name` becomes the title,
  `price` becomes the amount, and `__BASE__` becomes the image
  base URL (used to expand relative paths to `cdn2.csgo.com` URLs).
- **Chat history cap** (`MAX_HISTORY_TURNS = 50`) — `service.trimHistory`
  drops older turns before each call.
- **Run-time context** for targeting checks: the widget passes
  `document.documentElement.lang` as `locale` and `location.pathname` as
  `path` on every `/api/ad/next` and `/api/ad/sources` call.
- **Ineligibility note** in the widget when the active source is hidden
  by the frequency cap or targeting rules.

### Changed
- **URL handling**: every outbound URL now goes through
  `ensureAllowedUrl`, which enforces `allowHosts` and
  `allowPrivateNetwork`. Out-of-allowlist targets throw
  `hostNotAllowed`; loopback/RFC1918 targets throw
  `privateNetworkDisabled` unless `allowPrivateNetwork: true`.
- **Response body cap**: `readBoundedResponse` enforces
  `maxResponseBytes` (default 8 MiB) on every feed + chat call and
  cancels the upstream response as soon as the cap is exceeded.
- **Stream cap**: `streamAdEndpoint` enforces the same cap on the total
  bytes it buffers from a streaming response.
- **Route table**: `/api/ad/sources` is now POST (so the widget can pass
  run-time context for eligibility). `GET` returns the same shape with
  no eligibility filtering.
- **Schemastery schemas** for `AdSourceConfig` extended with the new
  v0.3 fields and validation bounds (poll interval 2 s … 1 h, response
  cap 1 KiB … 64 MiB, etc.).
- **All UI copy** is now in `src/locales/{en,zh}.ts` (host) and
  `src/client/locales/{en,zh}.ts` (widget). `t()` and `dictionary()` are
  re-exported from both halves.

## 0.1.0 — Initial release

- Single ad source; feed polling; credentials (login / password / apiKey
  / token + matching `*Env` variants).
- Simple creative rendering (video / gif / image / text / message) and
  non-streaming chat.
- Settings section with `enabled` / `visible` / `activeSourceId` toggles.
- English-only UI copy.
