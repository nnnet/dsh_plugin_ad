# Fix widget drag + tyan.ai per-card click-through

## Context

The user reported three real defects in the dsh-ad widget:

1. **Drag on the tyan.ai video widget always ends in a tyan.ai tab opening.**
   User tries to grab and move the widget; a tiny mouse jitter (< 3 px) is
   detected as "not a drag" by the widget, the browser still fires `click`,
   and the widget's `onClick` (line 318) calls `openClickThrough(item)` →
   `window.open(item.clickUrl)`. The 3-px threshold in
   `AdWidget.tsx:208` is too tight — natural hand jitter classifies a
   "drag" as a "click", so the user can never move the widget without a
   tab popping up.

2. **Drag on a CS:GO skin (MarketplaceRenderer) doesn't work at all.**
   Two compounding causes:
   - The `useEffect` that registers the document-level `mousemove`/
     `mouseup` listeners (lines 220-255) re-runs on every
     `display.right/bottom/size` change. During a drag, `setDisplay`
     fires per `mousemove` → effect tears down and re-creates the
     listeners each tick. If a `mousemove` lands between cleanup and
     re-add, the drag stalls. (The reference to `display` in the
     dependency array is what makes this loop.)
   - `MarketplaceRenderer` returns a `<div className="productCard">`
     with `<button>`s inside (CTAs, carousel nav). The widget's
     `onMouseDownWidget` excludes `button, select, input, a,
     video[controls]` (line 215) — which is correct, but the user
     intuitively grabs the card body / image / title, which is *not*
     excluded. So drag *should* start there. The real failure is the
     re-binding effect.

3. **Click goes to `https://tyan.ai` (root), not the per-character
   messenger page.** `service.resolveClickThrough`
   (`src/service.ts:330-337`) currently:
   ```ts
   const source = this.sources.get(sourceId)
   if (source?.clickThroughUrl === undefined) return item.clickUrl
   return fillTemplate(source.clickThroughUrl, { itemId, clickUrl })
   ```
   The tyan source has `clickThroughUrl: "https://tyan.ai"` in
   `example.config.yaml:280` and the preset (`src/sources/tyan.ts:108`).
   `fillTemplate` with no `{…}` placeholders returns the bare URL —
   the per-item `clickUrl` (e.g. `https://tyan.ai/en/messenger?id=28979`)
   is silently dropped. The marketplace adapter already has the
   "prefer item-level override" rule (`test/marketplace-renderer.test.ts:77-84`
   documents it via `normalizeMarketplaceItem`), but that code path is
   only used when the source's content shape is a `product`; static-item
   video sources don't go through `normalizeMarketplaceItem`.

## Goal

- The widget is draggable from any non-control area; small mouse jitter
  during a click does **not** trigger click-through, and a successful
  drag never opens the destination URL.
- The tyan.ai video click opens the per-character messenger page
  (`https://tyan.ai/en/messenger?id=…`), not the root.
- No regression on CS:GO skin click-through (which is per-item via
  `normalizeMarketplaceItem` and is already correct).

## Plan

### 1. `src/service.ts` — prefer per-item `clickUrl`

`resolveClickThrough` flips priority: per-item `clickUrl` wins;
`source.clickThroughUrl` is the **fallback** template (with `{itemId}`
substitution for marketplace sources that rely on it, like CS:GO with
`https://market.csgo.com/item/{itemId}?utm_source=dsh-ad`).

```ts
resolveClickThrough(sourceId: string, item: AdItem): string | undefined {
  const source = this.sources.get(sourceId)
  if (item.clickUrl !== undefined && item.clickUrl !== '') return item.clickUrl
  if (source?.clickThroughUrl === undefined) return undefined
  return fillTemplate(source.clickThroughUrl, {
    itemId: encodeURIComponent(item.id),
    clickUrl: item.clickUrl ?? '',
  })
}
```

Verify with a quick test: tyan item has `clickUrl:
'https://tyan.ai/en/messenger?id=28979'` and source has
`clickThroughUrl: 'https://tyan.ai'` → result must be the messenger
URL. CS:GO item from `normalizeMarketplaceItem` has its per-item
`clickUrl` already set to the resolved marketplace URL, so behavior
for skins is unchanged.

### 2. `src/client/AdWidget.tsx` — fix drag/click interaction

Three changes inside the widget, all in the same file:

a) **Register drag listeners once, not per render.** Move the
   `useEffect` that adds `mousemove`/`mouseup` so its dependency
   array is `[]` (or `[openClickThrough]`, the only function it
   actually needs). The handlers read fresh values from refs so they
   don't go stale. Add three refs: `dragRef`, `draggedRef`,
   `suppressClickRef` (new). The state-setter for display keeps
   working, but the effect no longer re-binds on every position
   change.

b) **Use a `suppressClickRef` to swallow the click that follows a
   real drag.** When `onUp` sees `wasDragged === true`, set
   `suppressClickRef.current = true` for one event. The widget's
   `onClick` handler checks the ref and bails out if it's set,
   clearing it in the process. This catches edge cases where the
   browser does fire a click after a small drag (some trackpads,
   touch devices).

c) **Raise the drag threshold from 3 px to 6 px and add a
   time-based "long enough to be a click" check.** A click that
   lasts < 120 ms with < 6 px movement is treated as a tap
   (open click-through). Anything else is a drag (no click). This
   gives the user a clear "I moved it" feel without losing the
   one-tap open behavior.

Files modified: `src/client/AdWidget.tsx` (one component, drag block
lines 206-255 + click handler line 318).

### 3. `src/sources/tyan.ts` — keep the fallback template, but make it safe

The source-level `clickThroughUrl: 'https://tyan.ai'` is still useful
as a final fallback if some future item has no `clickUrl`. Leave the
field. The fix in #1 makes it irrelevant for the current items. No
file change needed for behavior, but the docstring at
`src/sources/tyan.ts:75-76` ("Fallback click-through URL when an
avatar has no per-item pageUrl.") is now accurate — update it to
reflect the new priority (item `clickUrl` first, source template
second). One-line doc change.

### 4. Verification

Manual: in dev, click a tyan video → opens the messenger page; grab
the widget anywhere and move it > 6 px → no tab opens, position saves
to `/api/ad/display`; same drag on a CS:GO skin card → works; single
click on a skin image → opens the marketplace item URL (unchanged).

Automated: add one test to `test/sources.test.ts` or a new
`test/service.test.ts` asserting:
- `resolveClickThrough` for tyan source returns the per-item messenger
  URL.
- `resolveClickThrough` for a marketplace-style source
  (`clickThroughUrl: 'https://x/item/{itemId}'`, item without
  `clickUrl`) still substitutes `{itemId}` correctly.

Build: `npx tsdown` clean; `npx vitest run` passes.

## Critical files

- `src/service.ts` (resolveClickThrough — main fix for #3)
- `src/client/AdWidget.tsx` (drag/click — main fix for #1, #2)
- `src/sources/tyan.ts` (one-line docstring)
- `example.config.yaml` — no change required; per-item `clickUrl` is
  already set correctly
- `test/sources.test.ts` (or new `test/service.test.ts`) — add the
  per-item-preferred assertion

## Out of scope

- Touch behavior. The current code uses `touch-action: none` (CSS
  line 31) which is enough to prevent native scroll; pointer events
  aren't refactored here. If the user reports touch issues, that's a
  follow-up.
- The `MarketplaceRenderer` outer `div` doesn't add its own
  `onMouseDown` stop; the widget's drag continues to work on
  card-body drags (image, title, body text). The "drag from the
  widget frame area" behavior is unchanged.
