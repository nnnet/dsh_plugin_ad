# `@linxin666/dsh-ad-pet`

A pet-style advertising plugin for DeepSeek Harness / DSH Web. It is based on the architecture of `@linxin666/dsh-pet`: a host service owns state and network access, HTTP routes form a narrow browser API, and the browser mounts one page-global floating surface.

## What changed

- UI copy is split into `src/locales/en.ts` and `src/locales/zh.ts`.
- Runtime/API constants are in `src/constants.ts`; host diagnostics are in `src/messages.ts`.
- Locale switching is observed from `document.documentElement.lang`, so the pet rerenders after DSH changes language.
- Advertising sources are data-driven. The plugin does not hard-code a marketplace, ad network, media schema, or AI vendor.
- A source can return text, messages, cards, images, GIFs, MP4/video URLs, arbitrary JSON, product links, and an assistant id.
- Arbitrary source-specific actions can be configured, including product details, checkout/navigation, recommendations, and AI chat.
- Source responses remain server-side until normalized into the browser snapshot. Credentials are never sent to the client.
- Credentials can be supplied through environment variables or literal strings. Environment variables are strongly recommended.
- Media is fetched through a host-side proxy with source-host allowlisting and byte limits.

## Configuration

Use `config/ad-pet.example.json` as a starting point. The host plugin also accepts the same object as plugin config. A JSON file can be loaded with `configFile` or `DSH_AD_PET_CONFIG`.

The source contract is intentionally generic:

- `baseUrl`: source origin.
- `allowHosts`: explicit host allowlist for API/CDN/landing/media URLs.
- `auth`: username/password, bearer token, or extra headers. Each secret is either a literal or `{ "env": "ENV_NAME" }`.
- `request`: arbitrary GET/POST/PUT/PATCH request, query, headers and JSON body.
- `mapping`: dot-path mappings from arbitrary source JSON into the ad card model.
- `actions`: arbitrary named requests that can be invoked by future UI integrations.
- `assistant`: names the action used for AI chat.
- `metadata`: opaque source metadata, preserved for integrations.

Template expressions use `{{path}}`, for example `{{payload.productId}}` and `{{locale}}`.

### Marketplace example

A marketplace can expose a campaign endpoint returning:

```json
{
  "data": {
    "items": [
      {
        "id": "sku-42",
        "title": "Product title",
        "copy": "Short promotional message",
        "creative": { "type": "video" },
        "media": { "image": "https://cdn.example.com/sku-42.webp", "video": "https://cdn.example.com/sku-42.mp4" },
        "landing": { "url": "https://shop.example.com/product/sku-42" },
        "assistant": { "id": "product-assistant-42" }
      }
    ]
  }
}
```

The mapping in `config/ad-pet.example.json` turns that into a card and the configured assistant endpoint handles product questions.

## Security

Do not put buyer credentials in the browser or in a source response. Prefer:

```json
"username": { "env": "AD_MARKETPLACE_USERNAME" },
"password": { "env": "AD_MARKETPLACE_PASSWORD" }
```

The plugin rejects non-HTTP(S) source URLs, restricts requests to `baseUrl` or `allowHosts`, blocks private-network hosts by default, limits JSON/media response sizes, and does not follow redirects. If a legitimate deployment needs an internal source, set `allowPrivateNetwork: true` and keep `allowHosts` narrow.

## Extending the UI

The normalized `AdItem` supports `text`, `message`, `card`, `image`, `gif`, `video`, `html`, and `raw`. The raw source object is retained when `mapping.raw` is true, so a future renderer can expose arbitrary marketplace fields without changing the transport contract.

`actions` and `assistant` are deliberately source-defined. This allows a marketplace to add product details, cart operations, recommendations, AI chat, or another workflow without adding a new plugin release for every source.
