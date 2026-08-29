# TODO — стадии развития `dsh_plugin_ad`

Документ описывает **4 стадии** эволюции плагина от «просто показать картинку»
до «автономной рекламной системы с A/B-тестированием». Каждая стадия — это
полностью работающий плагин, не черновик: то, что уже есть в `main`, отмечено
как `✓ Готово`; новое — как `→ Работа`.

Цель документа — зафиксировать, **что уже работает сегодня** и **в каком
порядке** добавлять новое, чтобы каждое следующее улучшение ложилось на
предыдущее, а не переписывало его.

---

## Стадия 1 — `v0.3.x` — Минимальный показ ✓ Готово

**Суть стадии:** виджет должен показать хоть что-то. Одна активная
конфигурация, один источник, простой креатив или минимальная карточка.

### Что есть

- `AdService` (host, `src/service.ts`): заводит `Map<id, AdSourceConfig>`,
  запускает `setInterval` поллер на каждый `source.feed.url` (интервал
  `pollIntervalMs`, по умолчанию 60 с), кэширует `AdItem[]` для каждого
  source, отдаёт `nextItem()` с round-robin курсором.
- `AdService.listSources()`: отдаёт `AdSourceView[]` (id, name, contentTypes,
  hasChat, chatStreaming, eligible, ineligibleReason, campaignLabel, actions).
  На этом списке работает source picker в виджете.
- `AdService.nextItem()`: возвращает очередной item, подставляет
  `clickUrl` из `source.clickThroughUrl` (с `{itemId}` плейсхолдером).
- `AdService.isEligible()`: проверка `frequencyCap` (rolling window) +
  `targeting` (locale/path/tags). Неэлигабельный source скрывается.
- Routes (`src/routes.ts`):
  - `POST /api/ad/sources` — список с фильтром по `AdRuntimeContext`.
  - `POST /api/ad/next` — следующий item.
  - `POST /api/ad/refresh` — ручной рефреш.
  - `POST /api/ad/click` — fire-and-forget click beacon.
  - `POST /api/ad/impression` — fire-and-forget impression.
  - `POST /api/ad/track` — `event: impression|click|conversion`,
    проксирует в `source.tracking.*Url`.
  - `POST /api/ad/action` — вызов `source.actions[].endpoint` с payload.
  - `POST /api/ad/chat` и `POST /api/ad/chat/stream` (SSE) — ассистент.
  - `GET|POST /api/ad/cart/*` — корзина (add/qty/remove/clear).
- `AdAdapter` (`src/adapter.ts`): generic HTTP с `allowHosts`,
  `allowPrivateNetwork`, `maxResponseBytes` (default 8 MiB), `responsePath`,
  шаблоны `{itemId}`/`{cursor}` в url/body. CS:GO flat-map через sentinel'ы
  `__HASH_NAME__`/`__PRICE__`/`__BASE__` → синтез cdn2.csgo.com webp URL.
- Sources (`src/sources/`): `buildCsgoMarketSource()`, image templates
  (`csgoImageUrl`, `steamImageUrl`, `dotaImageUrl`).
- Клиент (`src/client/AdWidget.tsx`): useState/useEffect, fetch `sources` →
  `setSourceId(first.eligible)`, далее `setInterval(fetchNext, 15_000)`.
  Маршрутизация renderer'а: `item.type === 'product'` →
  `<MarketplaceRenderer>`, иначе → `<SimpleCreative>`. Кнопка чата
  (`<ChatPanel>`), кнопка корзины (`<CartDrawer>`).
- i18n: `src/locales/{en,zh}.ts` + `src/client/locales/{en,zh}.ts`,
  `t()` с `{name}` плейсхолдерами, выбор по `document.documentElement.lang`
  (`zh*` → Chinese, иначе English).
- Settings: `installSettingsSection(...)` с `enabled/visible/activeSourceId`.
- Тесты: `test/adapter.test.ts`, `test/config.test.ts`,
  `test/marketplace-renderer.test.ts`, `test/sources.test.ts` (vitest).

### Ограничения стадии (то, что юзер называет «уныло и не кликается»)

- **Никакой интерактивности внутри креатива.** `MarketplaceRenderer`
  показывает carousel/price/CTAs/details, но `ProductCarousel` не имеет
  prev/next — листает сам по таймеру, без ручного управления.
- **Кнопки CTAs не привязаны к доменной логике.** `CtaRow` умеет «buy»,
  «link», «addToCart», «chat», но обработчики глобальные (дёргают
  `window.open` / `cartAdd` / `setShowChat(true)`), без per-source override.
- **Нет раскрытия медиа на клик.** Клик по `ProductCarousel` сразу открывает
  `clickUrl` в новой вкладке — нет lightbox, нет зума, нет превью на месте.
- **Слабая визуальная иерархия.** CSS (9 КБ в `ad.module.css`) рисует плоский
  card без состояний hover/focus, без skeleton'а, без градиентов/теней.
- **Нет sticky-режима и нет dismiss.** Виджет либо висит, либо нет — нет
  «закрыл на сегодня», нет «свернуть в пузырь».
- **Source picker спрятан.** В `<AdWidget>` нет UI для переключения
  источника, даже если их несколько.
- **Нет «trending»/«personalized» логики.** Round-robin курсор.

### Acceptance criteria

- [x] `pnpm run build` проходит, `lib/index.js` + `lib/client.js` + `lib/style.css` создаются.
- [x] `cordis.patch.yml` инжектит `id: ad, name: dsh_plugin_ad` в roster.
- [x] `POST /api/ad/sources` отдаёт список CS:GO source с `eligible: true`.
- [x] `POST /api/ad/next` возвращает `AdItem` с синтезированной webp-картинкой.
- [x] Виджет монтируется в `<div data-dsh-ad-root>`, рисует `<MarketplaceRenderer>`.

---

## Стадия 2 — `v0.4.x` — Карусель + интерактив → Работа

**Суть стадии:** превратить «плоскую карточку» в «живую витрину». Пользователь
должен **управлять** тем, что видит: листать медиа руками, открывать превью,
сворачивать виджет, переключать источник.

### Что добавляется

#### 2.1 Интерактивный `ProductCarousel`
- Prev/Next стрелки, точки-индикаторы, свайп (touch events).
- Hover/focus состояния, keyboard nav (←/→).
- Клик по миниатюре — не открывает `clickUrl`, а переключает на неё.
- `clickUrl` открывается только с primary CTA (см. 2.3).

#### 2.2 Media lightbox
- Клик по главной картинке → modal поверх виджета с увеличением.
- Video (mp4) в lightbox проигрывается inline (без перехода).
- Pinch-to-zoom для touch, scroll-wheel zoom для desktop.
- Закрытие: Esc, клик вне, кнопка close.

#### 2.3 Per-CTA `actionId` resolution
- Сейчас `CtaRow` работает по `kind` (buy/link/addToCart/chat). В v0.4
  каждый CTA может нести `actionId` (из `source.actions[]`) и идти в
  `POST /api/ad/action` минуя click-through.
- `cta.kind = 'chat'` остаётся shortcut'ом для открытия `<ChatPanel>`,
  но дополнительно помечается `cta.actionId` если хочется server-side
  intent.

#### 2.4 Источник-picker в UI
- Если в `listSources` больше одного `eligible: true` — над carousel
  появляется horizontal pill-bar с `name` каждого source.
- Клик по pill — `setSourceId` + `useEffect` на `[sourceId]` уже
  триггерит `fetchNext()` (это в коде есть, но не подключено к UI).

#### 2.5 Dismiss / collapse
- Кнопка `×` в углу виджета → закрывает на сессию (`sessionStorage`).
- Кнопка `_` → сворачивает в круглый пузырь (CSS only) с counter'ом
  непрочитанных (по `impressions`).
- Состояние «свернут» восстанавливается между страницами в той же
  сессии.

#### 2.6 Skeleton + loading states
- Пока `item === undefined` — `<Skeleton>` с фиксированной высотой.
- Пока `failed` — `<ErrorState>` с retry-кнопкой (`fetchNext()`).
- Hover на productCard — subtle elevation (тень, transform).

#### 2.7 Расширенная визуальная иерархия
- Типографика: serif для title (subtle luxury feel), sans для body.
- Акцент-цвет из `source.campaign.accentColor` (новое поле в `AdCampaign`).
- Анимации: `prefers-reduced-motion` уважается.

### Файлы, которые меняются / создаются

- `src/client/ProductCarousel.tsx` — добавить `useState<activeIndex>`, handlers.
- `src/client/MediaLightbox.tsx` — **новый**.
- `src/client/SourcesBar.tsx` — **новый**.
- `src/client/DismissControls.tsx` — **новый**.
- `src/client/Skeleton.tsx`, `src/client/ErrorState.tsx` — **новые**.
- `src/client/CtaRow.tsx` — поддержка `actionId`.
- `src/client/AdWidget.tsx` — встроить новые компоненты.
- `src/client/ad.module.css` — стили hover/focus/elevation.
- `src/client/locales/{en,zh}.ts` — добавить ключи `carousel.next`,
  `carousel.previous`, `lightbox.close`, `widget.dismiss`, `widget.collapse`,
  `widget.sources`.

### Acceptance criteria

- [ ] Карусель переключается стрелками и свайпом, без перезагрузки.
- [ ] Клик по миниатюре не открывает новую вкладку.
- [ ] Lightbox показывает картинку/видео в полный размер, закрывается Esc.
- [ ] CTA с `actionId` идёт через `POST /api/ad/action` (видно в Network).
- [ ] Source picker переключает активный source, счётчик items обнуляется.
- [ ] Кнопка `×` сохраняет «закрыто» в `sessionStorage`, виджет не появляется до конца сессии.
- [ ] Кнопка `_` сворачивает в пузырь; badge с цифрой (impressions count).
- [ ] Skeleton рисуется до первого `item`; error state — после 3 неудач.
- [ ] `prefers-reduced-motion: reduce` отключает анимации.

---

## Стадия 3 — `v0.5.x` — Конверсионная воронка → Работа

**Суть стадии:** пользователь уже может взаимодействовать с виджетом. Теперь
каждое взаимодействие должно **заканчиваться покупкой** или хотя бы
осмысленным **intent**-событием. Добавляются формы, валидация, корзинная
логика, мульти-step checkout.

### Что добавляется

#### 3.1 Полноценный cart → checkout flow
- Сейчас `cart.add` принимает `{itemId, qty}`. В v0.5:
  - `addToCart` открывает **inline-форму** в `MarketplaceRenderer` (qty, опции).
  - `cart` drawer показывает **per-line** details с thumbnail'ом из `item.media[0]`.
  - Кнопка `Checkout` идёт в `source.actions['checkout']` (если есть) или
    в `clickUrl` с `?utm_cart=…` параметром.
- Cart mirror теперь умеет **persist** в `localStorage` между сессиями
  (опционально, opt-in через `source.cart.persist: true`).

#### 3.2 Wishlist / favourites
- Сердечко на карточке → `POST /api/ad/action { actionId: 'wishlist' }`
  (если source объявил это действие в `actions[]`).
- Отдельная вкладка в cart drawer — wishlist (если включено).

#### 3.3 Inline forms (заказ, доставка, промокод)
- `CtaRow` теперь умеет рендерить не только кнопки, но и inline-формы
  (`<CtaForm>`): поле ввода промокода, выбор варианта, quantity stepper.
- Сабмит формы — это `POST /api/ad/action` с собранным payload.
- Validation на клиенте (required, min/max qty), error states на
  отказе server-side.

#### 3.4 Multi-step checkout
- Для source'ов с `actions: ['details', 'addToCart', 'checkout']` —
  `<MarketplaceRenderer>` умеет переключаться между step'ами:
  - step 1: details + addToCart
  - step 2: cart drawer (auto-open)
  - step 3: checkout (actionId='checkout', payload={lines, total})
- Stepper-индикатор в верхней части card.

#### 3.5 Chat → cart handoff
- В `<ChatPanel>` AI-ассистент может послать в чат `inline-product`:
  продукт-рекомендация прямо в чате с кнопкой `Add to cart`.
- Клик по `inline-product` → `addToCart` через `addToCartFromChat` action.
- История чата сохраняется в `localStorage` до 50 turns (уже есть
  `MAX_HISTORY_TURNS` на host).

#### 3.6 Receipt / thank-you
- После успешного `POST /api/ad/action { actionId: 'checkout' }` —
  `<MarketplaceRenderer>` показывает `<ReceiptScreen>` (replaces card).
- Receipt ссылается на order id из server response.

#### 3.7 Trust signals
- Иконки: «Verified», «Fast shipping», «30-day return» — из
  `source.signals: string[]` (новое поле).
- Микро-отзывы / рейтинг: `source.rating: { score, count }` (уже есть
  в `MarketplaceExtras.rating`).

### Файлы

- `src/client/CartDrawer.tsx` — `useState<step>` для multi-step, persist.
- `src/client/MarketplaceRenderer.tsx` — поддержка `step`, inline-формы.
- `src/client/CtaForm.tsx`, `src/client/QtyStepper.tsx` — **новые**.
- `src/client/ReceiptScreen.tsx` — **новый**.
- `src/client/ChatPanel.tsx` — `inline-product` rendering.
- `src/cart.ts` — `persist`/`restore` методы.
- `src/service.ts` — `action()` теперь возвращает `{ ok, data, redirect? }`.
- `src/config.ts` — `AdActionConfig` расширен `kind: 'addToCartInline' |
  'checkout' | 'wishlist'`, `AdSourceConfig` — поля `cart.persist`,
  `signals`, `rating`.
- `src/client/locales/{en,zh}.ts` — `cart.empty`, `cart.checkout`,
  `form.promoCode`, `form.submit`, `receipt.title`, `receipt.continueShopping`.

### Acceptance criteria

- [ ] `addToCart` через inline-форму отражается в cart drawer в реальном времени.
- [ ] Cart drawer persist через `localStorage` опционально (toggle в settings).
- [ ] `Checkout` через `actionId='checkout'` открывает receipt.
- [ ] Чат показывает inline-product, клик добавляет в cart.
- [ ] Промокод-форма валидируется, error отображается.
- [ ] Qty stepper работает, не уходит в 0 без явного `remove`.

---

## Стадия 4 — `v0.6.x` — Автономное A/B-тестирование → Работа

**Суть стадии:** плагин сам решает, **что** показать пользователю, на основе
данных. Несколько вариантов креатива / источника / порядка элементов
крутятся одновременно, метрики собираются автоматически, и система сама
выбирает winner'а.

### Что добавляется

#### 4.1 Experiment layer
- `AdService` заводит `experiments: Map<expId, Experiment>` где
  `Experiment = { variants: Variant[]; allocation: { sourceId, weights } }`.
- `Variant` — это либо `AdSourceConfig` целиком, либо override
  (`{ fields: { 'item.title': 'New text' } }`), либо template substitution
  (`{ templateId: 'carousel-v2' }`).
- Allocation либо deterministic hash от `userId` (stable), либо
  round-robin, либо weighted random.

#### 4.2 Метрики и event-store
- Host добавляет `MetricsStore` (in-memory ring buffer + periodic flush):
  - `impression { expId, variantId, sourceId, itemId, locale, path, ts }`
  - `click { expId, variantId, sourceId, itemId, position, ts }`
  - `conversion { expId, variantId, sourceId, itemId, value, ts }`
  - `dwellTime { expId, variantId, itemId, ms, ts }`
- Flush идёт в `source.tracking.experimentUrl` (новое поле) или в
  встроенный file-based sink (`./metrics.ndjson`).
- Privacy: `userId` либо из cookie, либо `crypto.randomUUID()` в
  `sessionStorage`, без PII.

#### 4.3 Statistical engine
- Host считает для каждого `expId`:
  - `impressions`, `clicks`, `conversions`, `CTR`, `CVR`,
    `mean dwell time` per variant.
  - Bayesian posterior (Beta distribution) на CTR/CVR.
  - Когда posterior одной variant'ы расходится с другой на >95% —
    promote winner'а (например, 100% allocation), demote loser'а
    (0%, остаётся как control).
- Решение логируется как `experiment:decision` event.

#### 4.4 Variant rendering
- `AdService.nextItem()` принимает решение experiment'а:
  - выбирает variant по allocation,
  - возвращает `item` уже с `experimentId`/`variantId` в metadata.
- Клиент присылает `expId`+`variantId` в `/impression`, `/click`,
  `/conversion`, `/track`.
- `<MarketplaceRenderer>` имеет data-атрибут `data-exp` / `data-variant`
  для девтулзов и аналитики.

#### 4.5 Multi-armed bandit (опционально)
- Кроме классического A/B, поддержать Thompson sampling для exploration.
- Config: `experiment.strategy: 'fixed' | 'thompson'`.
- `Thompson sampling` постоянно подкручивает allocation, минимизирует regret.

#### 4.6 Guardrails
- Negative metrics: если conversion rate падает ниже baseline на
  20% — variant автоматически отключается (`safe-mode`).
- Manual kill-switch в `AdService.setEnabled(expId, false)`.
- `experiment.paused: true` в config.

#### 4.7 Developer UI
- `GET /api/ad/experiments` — список текущих experiments с allocation
  и метриками.
- `POST /api/ad/experiments/:id/promote` — ручной promote variant.
- Settings: «experiments» tab с теми же данными, read-only.

### Файлы

- `src/experiments/types.ts`, `src/experiments/store.ts`,
  `src/experiments/engine.ts`, `src/experiments/bandit.ts` — **новые**.
- `src/metrics/store.ts`, `src/metrics/sink.ts` — **новые**.
- `src/service.ts` — `nextItem` через `experiments.choose()`,
  `recordImpression/Click/Conversion` через `metrics.record()`.
- `src/routes.ts` — `POST /api/ad/conversion`, `GET /api/ad/experiments`,
  `POST /api/ad/experiments/:id/promote`.
- `src/config.ts` — `AdExperimentConfig`, `AdVariantConfig`,
  `AdSourceConfig.tracking.experimentUrl`.
- `src/client/AdWidget.tsx` — data-атрибуты на root, fetch experiments
  для `DevPanel`.
- `src/client/DevPanel.tsx` — **новый** (только в dev-сборке).
- `src/locales/{en,zh}.ts` — host-side копи для experiments UI.

### Acceptance criteria

- [ ] `AdConfig.experiments[]` парсится schemastery.
- [ ] При двух variants 50/50, ~50% impressions у каждого.
- [ ] При deterministic hash — один и тот же userId всегда в одной variant'е.
- [ ] Conversion rate считается корректно (unit-тест на metrics store).
- [ ] Bayesian posterior сходится к winner'у за разумное время.
- [ ] Kill-switch: `AdService.setEnabled('exp1', false)` останавливает experiment.
- [ ] `GET /api/ad/experiments` показывает live метрики.
- [ ] Manual promote работает, allocation меняется сразу.

---

## Карта развития (одна картинка)

```
Стадия 1  ✓ Готово   ──┐
                        │  фундамент: services, routes, i18n, CS:GO preset
                        ▼
Стадия 2  → Работа    carousel + lightbox + sources-picker + dismiss
                        │  пользователь управляет тем, что видит
                        ▼
Стадия 3  → Работа    cart → checkout → receipt, forms, chat-handoff
                        │  каждое взаимодействие → intent
                        ▼
Стадия 4  → Работа    experiments, metrics, Bayesian engine, bandit
                           система сама выбирает winner'а
```

## Открытые вопросы

- i18n для стадий 2-4: `ru` сейчас **не** нужен. В стадии **0.6.x**
  добавить механизм **расширения любым языком** без правки ядра —
  `src/locales/<code>.ts` + `src/client/locales/<code>.ts`, регистрация
  через `dictionary.register(code, dict)`. Хост и клиент автоматически
  подхватывают по `document.documentElement.lang.startsWith(code)`.
- `userId` для experiments хранится в **`sessionStorage`** (на стороне
  host'а — генерируется плагином при первом event'е, если отсутствует;
  не выходит за пределы сессии, consent banner не нужен).
- Experiment strategy: **оба** режима обязательны и **выбираемы через
  config** — `experiment.strategy: 'fixed' | 'thompson'`. `fixed` =
  классический A/B с ручным promote, `thompson` = multi-armed bandit с
  continuous re-allocation. Default в config: `fixed`.
- Метрики: **in-memory ring buffer + periodic flush в NDJSON файл**
  (один файл на source, ротация по размеру). Без внешних sink'ов на
  стадии 0.6.x; Prometheus/ClickHouse — отдельная стадия >0.6.
