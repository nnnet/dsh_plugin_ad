# dsh-ad

Configurable ad widget plugin for the [dsh](https://github.com/deepseek-ai) web GUI. One plugin install can point at any number of ad sources — a CS:GO skin marketplace, a fashion outlet, a house-banner CDN, an internal ad server — without a code change: only the config file changes.

The widget renders either a simple video/gif/image/text/message/html/card/raw creative or a full **marketplace product card** (media carousel, price/discount, CTA buttons, expandable product details, cart drawer) and, when the source has one, an **AI shopping-assistant chat** with live token streaming.

## Source/config contract

Every ad source is described by a single `AdSourceConfig` (see `src/config.ts`):

```yaml
sources:
  - id: csgo-market
    name: "CS:GO Market"
    contentTypes: [image, product, chat]
    allowHosts: [market.csgo.com, cdn2.csgo.com]
    auth:
      loginEnv: CSGO_LOGIN
      passwordEnv: CSGO_PASSWORD
    feed:
      url: "https://market.csgo.com/api/v2/prices/RUB.json"
      method: GET
      responsePath: "data.items"   # optional; "." for the whole body
      timeoutMs: 8000
    pollIntervalMs: 60000
    maxResponseBytes: 1048576      # optional response size cap
    clickThroughUrl: "https://market.csgo.com/item/{itemId}?utm_source=dsh-ad"
    chat:
      endpoint:
        url: "https://market.csgo.com/api/v2/assistant/chat/stream"
        method: POST
        body: { message: "{message}", history: "{history}" }
      streaming: true
      streamFormat: sse
      streamTokenPath: "delta"
    frequencyCap: { maxImpressions: 5, windowMs: 600000 }
    targeting:
      locales: [en, zh]
      paths: [/shop]
    campaign: { id: csgo-market, placement: dsh-ad, priority: 100 }
```

The same `AdSourceConfig` shape is consumed by both the host (for polling feeds and proxying chat) and the client (for choosing what to render). Credentials never reach the browser.

See [`example.config.yaml`](./example.config.yaml) for a full CS:GO example and a minimal banner example.

## What's in the box

| File | What it does |
|---|---|
| `src/index.ts` | Host entry: registers the service + routes, installs the settings section. |
| `src/config.ts` | `AdConfig` / `AdSourceConfig` / `AdCredentials` / `AdEndpointConfig` / `AdActionConfig` + schemastery schemas + `loadConfigFromFile` for `DSH_AD_CONFIG` / `configFile`. |
| `src/service.ts` | `AdService` — owns sources, polls feeds, enforces frequency cap + targeting, proxies chat, runs actions, forwards tracking. |
| `src/routes.ts` | `/api/ad/*` JSON routes: `sources`, `next`, `refresh`, `click`, `impression`, `track`, `action`, `chat`, `chat/stream`, `cart/*`. |
| `src/adapter.ts` | Generic HTTP adapter: templating, credential headers, allowlist + private-network checks, size caps, response-path extraction, stream (text + SSE), best-effort feed → `AdItem` normalization (with CS:GO flat-map sentinels). |
| `src/marketplace-renderer.ts` | Marketplace-specific normalization helpers (extras, default CTAs, default details, campaign label, absolutize). |
| `src/cart.ts` | Per-source in-memory cart mirror. |
| `src/mapping.ts` | Tiny `getPath` / `renderTemplate` helpers used by the adapter's `mapping` config. |
| `src/mount-once.ts` | Single-instance host guard. |
| `src/http.ts` | Bounded JSON body reader + JSON writer. |
| `src/constants.ts` | All numeric/path limits in one place. |
| `src/messages.ts` | All host-side diagnostic strings. |
| `src/locales/{en,zh}.ts` | Host-side UI copy. |
| `src/sources/csgo.ts` | Built-in CS:GO Market source preset (`buildCsgoMarketSource`). |
| `src/sources/image-templates.ts` | URL helpers for known ad sources (`csgoImageUrl`, `steamImageUrl`, `dotaImageUrl`, ...). |
| `src/sources/index.ts` | Re-exports of the built-in source adapters. |
| `src/client/index.tsx` | Browser entry: mounts the floating widget. |
| `src/client/AdWidget.tsx` | Top-level widget: source picker, rotation, cart toggle, chat toggle, impression beacon. |
| `src/client/MarketplaceRenderer.tsx` | Full product card (Phase 2): carousel + price + CTAs + details + campaign badge. |
| `src/client/SimpleCreative.tsx` | Single-asset creative for non-product items. |
| `src/client/{ProductCarousel,PriceTag,CtaRow,ProductDetails,CartDrawer,ChatPanel}.tsx` | Composed pieces. |
| `src/client/locales/{en,zh}.ts` | Widget UI copy. |
| `src/client/{types,constants,locales,ad.module.css}.{ts,tsx,css}` | Type mirrors, paths, dictionary, styles. |

## i18n

Two languages today: English and Chinese. The active dictionary is selected by `document.documentElement.lang` on the client and by the host's locale slot on the host; a `zh*` value selects Chinese, everything else falls back to English. Add a new language by creating a new `src/locales/<code>.ts` + `src/client/locales/<code>.ts` and an `else if` branch in both `dictionary()` functions. Every key in `en.ts` must exist in `zh.ts` (and vice versa) — the `AdKey` / `AdHostKey` types are derived from `en.ts` so a missing key is a compile error.

## Content types

A single source may declare any combination of `contentTypes`:

- `video` / `gif` / `image` / `message` / `text` — simple creatives, rendered by `SimpleCreative`.
- `html` — sanitized HTML body, rendered as a `dangerouslySetInnerHTML` block.
- `product` — full marketplace card, rendered by `MarketplaceRenderer` (carousel, price/discount, CTAs, expandable details).
- `card` / `raw` — passthrough shapes for custom renderers.
- `chat` — the source has a chat assistant. (`MarketplaceRenderer` adds the chat panel on demand when the item has CTAs of kind `chat`.)

## Security controls

- **`allowHosts`** — every outbound URL (feed, chat, media) is checked against this list. Empty means only the URL's own host is allowed.
- **`allowPrivateNetwork`** — defaults to `false`; set `true` only for local development and trusted internal services.
- **`maxResponseBytes`** — every response body is bounded; oversize bodies are rejected with `responseTooLarge` and the underlying stream is cancelled.
- **`frequencyCap`** — per-source rolling counter; the host will decline to serve more than `maxImpressions` creatives inside `windowMs`.

## Source actions, tracking, and built-in presets

Beyond the rotating feed + chat surface, every source can declare:

- **`actions[]`** — a list of named actions (`details`, `addToCart`, `checkout`, vendor-specific calls) the widget can invoke through `POST /api/ad/action { sourceId, actionId, payload }`. Each action has its own endpoint and optional credentials, executed server-side.
- **`tracking.{impression,click,conversion}Url`** — analytic beacons the host forwards to. The widget fires an impression on every rotation (`/api/ad/impression`) and a click on every click-through (`/api/ad/click`); a custom `/api/ad/track { event }` route is available for explicit host-side calls.
- **Built-in CS:GO Market preset** — `buildCsgoMarketSource({ currency, imageWidth, loginEnv, passwordEnv, ... })` returns a ready-to-use `AdSourceConfig` pointed at `market.csgo.com`'s public price feed with the right host allowlist, frequency cap, campaign, and `__HASH_NAME__` / `__PRICE__` / `__BASE__` mapping sentinels wired up. Use it from a tool that wants to inject the source at runtime, or copy the resulting config into YAML.
- **Image URL templates** — `csgoImageUrl(hashName, width)`, `steamImageUrl(iconUrl)`, `dotaImageUrl(hashName, width)` for vendors whose CDN follows a fixed pattern. The adapter itself stays source-agnostic.

## CS:GO example

The `example.config.yaml` ships with a working `csgo-market` source pointed at `https://market.csgo.com/api/v2/prices/RUB.json` and the `cdn2.csgo.com` image CDN. The adapter wraps each `{ hash_name, price }` record into a marketplace product, and `MarketplaceRenderer` shows a 458 px wide `webp` image with a price tag and a `Buy on CS:GO Market` CTA that opens the item page on `market.csgo.com`.

```bash
# Required: a CS:GO market account (free to register).
export CSGO_LOGIN="your-login"
export CSGO_PASSWORD="your-password"
```

## License

Apache-2.0
