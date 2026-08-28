# @linxin666/dsh-ad-pet

Configurable advertising pet plugin for DeepSeek Harness / DSH Web.

## v0.2 capabilities

- English + Simplified Chinese UI with runtime language switching.
- Marketplace cards: product title, brand, price, old price, discount, rating, badge, SKU and product id.
- Image galleries, GIFs and MP4/WebM media through a host-side allowlisted proxy.
- External landing pages.
- Configurable API actions for product details, cart, checkout, tracking and arbitrary source-specific operations.
- AI assistant with regular JSON responses or streaming SSE/chunked responses.
- Arbitrary raw source payloads are retained when `mapping.raw` is enabled.
- Credentials can be literal strings or environment variables. Credentials are resolved only on the host and never sent to the browser.
- Request paths, query parameters and JSON bodies support `{{payload.*}}` and `{{locale}}` templates.
- Source host allowlisting, private-network protection, response-size caps and request timeouts.

## Configuration

Pass `AdPetConfig` to the plugin or point `configFile` at a JSON file. The environment variable `DSH_AD_PET_CONFIG` can also select a configuration file.

Secrets may be specified as:

```json
{ "env": "AD_MARKETPLACE_PASSWORD" }
```

or directly as a string. Environment variables are recommended for production.

## Source contract

The plugin does not require a fixed marketplace API schema. `mapping` maps arbitrary JSON paths from the source response into the normalized UI model, while `raw: true` keeps the original creative. `actions` are arbitrary HTTP operations defined by the source. This allows the same pet to work with a marketplace, affiliate network, ad server, commerce backend or an AI-enabled catalog.

## Security model

Credentials are used only by the host-side service. Browser code receives normalized ad data and calls host routes. Media URLs must resolve to an allowlisted host. Private-network destinations are rejected unless explicitly enabled.

## Example

See `config/ad-pet.example.json` for a marketplace with product cards, video, gallery, cart, checkout, tracking and streaming AI assistant.


## 0.3 advertising platform features

The plugin now supports: campaign/placement metadata, source priority and fallback, explicit locale/path/tag targeting, impression/click/conversion tracking, frequency capping, A/B variant identifiers, and anonymous browser-session attribution.

### Targeting

Targeting is deliberately limited to context explicitly supplied by the host: locale, pathname and tags. The plugin does not inspect account profiles or collect personal attributes.

### Tracking

Configure `tracking.action` to point at a source API action. The plugin sends `impression`, `click`, and `conversion` events with ad/campaign/creative/product/session context.

### Frequency capping

`tracking.frequencyCap` limits impressions per campaign/creative in the host process. This is a safety/fallback cap, not a distributed billing-grade counter; authoritative billing and attribution should remain on the ad server.

### Fallback

If `source` is not fixed, eligible sources are ordered by `campaign.priority` and `campaign.weight`. A source that fails or returns no eligible creatives can be followed by another source.
