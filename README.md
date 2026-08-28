# @linxin666/dsh-ad

## v0.2

Полноценный marketplace-рендерер поверх того же контракта `AdSourceConfig`/
`AdItem` из v0.1 — конфиг источника **не менялся** (только два новых
опциональных поля в `chat`, см. ниже), меняться пришлось нормализации
элемента ленты (`adapter.ts`) и рендерингу (`client/*`):

- **Карусель медиа** (`AdItem.media: AdMedia[]`) — несколько видео/gif/картинок
  на одной карточке, с точками-индикаторами и стрелками; собирается из полей
  `media`/`gallery`/`videos`/`images`/`assets` в записи фида (или из старого
  одиночного `mediaUrl`, если источник ещё не отдаёт массив — обратная
  совместимость сохранена).
- **Цена/скидка** (`AdItem.price`) — текущая цена, зачёркнутая старая цена,
  бейдж скидки; вычисляется из `price`/`originalPrice`/`discountPercent`
  либо процент считается автоматически по разнице цен.
- **CTA-кнопки** (`AdItem.ctas`) — `buy` / `cart` / `link` / `chat`,
  извлекаются из `ctas`/`buttons`/`actions`/`cta` в записи фида.
- **Детали товара** (`AdItem.details`) — сворачиваемое описание + таблица
  характеристик (`specs`/`attributes`/`specifications`).
- **Корзина** (`src/cart.ts`) — локальное зеркало «что покупатель отметил»
  на процесс хоста (не пишет в реальный аккаунт маркетплейса — это задача
  CTA `buy`/`cart` со своим эндпоинтом); роуты `/api/ad/cart/*`.
- **Streaming-чат** — `POST /api/ad/chat/stream` проксирует ответ
  ассистента как поток SSE-фреймов (`data: {"delta": "..."}`) вместо
  ожидания полного JSON-ответа; включается двумя **аддитивными**
  полями в существующем `AdSourceConfig.chat`:
  - `streaming: true` — включает потоковый режим для источника;
  - `streamFormat: 'text' | 'sse'` (по умолчанию `'text'`) — считать ли
    каждый чанк тела ответа сырой дельтой текста, или парсить `data:`-строки
    SSE-протокола (с опциональным `streamTokenPath` для JSON-полезной
    нагрузки внутри `data:`).
  Старые конфиги без этих полей продолжают работать как в v0.1
  (`/api/ad/chat` — без изменений).

Один и тот же элемент ленты (`AdItem`) теперь может быть простым
`video`/`gif`/`image`/`text`/`message` (рендер не изменился) либо полным
`product`-элементом — тип определяется автоматически: если в записи есть
цена, CTA, детали или больше одного медиа — это `product`.


Конфигурируемый рекламный виджет-плагин для DeepSeek Harness (dsh),
сделанный на основе архитектуры плагина `@linxin666/dsh-pet` (тот же
Cordis-хост, тот же паттерн `/api/*`-роутов, тот же способ регистрации
settings-секции и словарей локализации).

## Что изменилось относительно `dsh-pet`

`dsh-pet` — плавающий питомец, реагирующий на активность модели.
`dsh-ad` использует ту же скелетную структуру (host-плагин + client-плагин
+ общий JSON API + settings-секция + локализация), но вместо питомца
показывает **рекламный виджет**, содержимое которого полностью описывается
конфигом, а не кодом:

- **Все строки интерфейса вынесены** в `src/locales/en.ts` и
  `src/locales/zh.ts` (единый ключевой набор, `src/locales/index.ts`
  выбирает словарь по `document.documentElement.lang` и деградирует к
  ключу, если перевод не найден — как и в оригинале). Ни один компонент
  не содержит текст внутри JSX/TSX напрямую.
- **Гибкий конфиг источника рекламы** (`src/config.ts`, `AdSourceConfig`) —
  ядро задачи. Один источник описывает:
  - `contentTypes` — какие форматы отдаёт источник: `video` (mp4), `gif`,
    `image`, `text`, `message`, `chat`;
  - `feed` — как получить ленту карточек (произвольный HTTP-эндпоинт:
    метод, заголовки, параметры, тело, путь до массива в JSON-ответе,
    таймаут — то есть можно подключить почти любой backend без правки кода);
  - `chat` — отдельный эндпоинт AI-ассистента (например, ассистент
    маркетплейса), с собственными или общими credentials;
  - `auth` — логин/пароль/`apiKey`/`token` **и** их `*Env`-варианты
    (`loginEnv`, `passwordEnv`, ...), которые читаются из переменных
    окружения хоста в момент запроса. Секреты никогда не покидают хост:
    роуты (`routes.ts`) отдают браузеру только нормализованные `AdItem`
    и текст ответа чата — без токенов/паролей;
  - `clickThroughUrl` — шаблон ссылки перехода (`{itemId}`, `{clickUrl}`);
  - `extra` — полностью открытый `Record<string, unknown>` для любых
    специфичных для источника полей, которые не укладываются в
    смоделированную схему (см. `example.config.yaml`).
- **Один источник = один маркетплейс.** Можно настроить несколько
  источников одновременно (`sources: AdSourceConfig[]`), переключать
  активный через настройки, у каждого — свой набор форматов и своя лента.

## Структура

```
src/
  config.ts        — типы и schemastery-схема AdSourceConfig / AdConfig
  adapter.ts        — универсальный HTTP-вызов эндпоинта + нормализация ленты в AdItem
  service.ts        — AdService: опрос источников, кэш, прокси чата (credentials только тут)
  routes.ts         — /api/ad/* JSON API (без единого секрета в ответах)
  http.ts           — общий JSON body/response хелпер (как в dsh-pet)
  mount-once.ts      — guard от повторного монтирования плагина (как в dsh-pet)
  index.ts          — host-точка входа: регистрирует сервис, роуты, settings-секцию
  locales/
    en.ts, zh.ts     — все строки интерфейса, ключ-в-ключ
    index.ts         — dictionary()/t() — выбор языка + подстановка {параметров}
  client/
    AdWidget.tsx      — рендер video/gif/image/text/message + чат-панель, переход по клику
    ad.module.css     — стили виджета
    locales.ts        — тонкий ре-экспорт словаря для клиентских компонентов
    index.ts          — монтирование виджета в document.body
```

## Пример конфига

См. `example.config.yaml` — источник `marketplace` показывает полный
пример (лента карточек, логин/пароль через переменные окружения,
чат с ИИ-ассистентом), источник `static-banner` — минимальный пример
(просто ротация картинок, без auth и чата).

```yaml
sources:
  - id: marketplace
    name: "Acme Marketplace"
    contentTypes: [video, gif, text, message, chat]
    auth:
      loginEnv: ACME_LOGIN
      passwordEnv: ACME_PASSWORD
    feed:
      url: "https://api.acme-marketplace.example/v1/ad-feed"
      responsePath: "data.items"
    clickThroughUrl: "https://acme-marketplace.example/item/{itemId}"
    chat:
      endpoint:
        url: "https://api.acme-marketplace.example/v1/assistant/chat"
        method: POST
        body: { message: "{message}", history: "{history}" }
      replyPath: "reply"
```

## Безопасность credentials

- Используйте `loginEnv`/`passwordEnv`/`apiKeyEnv`/`tokenEnv` — секрет
  читается из `process.env` в момент запроса и никогда не сохраняется
  в конфиг-файле. Прямые поля (`login`, `password`, ...) оставлены для
  локальных экспериментов; не коммитьте в них реальные данные.
- `AdService.listSources()` — единственный источник данных для клиента о
  списке источников — отдаёт только `{ id, name, enabled, contentTypes,
  hasChat }`, без единого поля из `auth`/`chat.auth`.
- Чат проксируется через хост (`AdService.chat`): браузер отправляет
  только текст сообщения и историю, а привязка к учётке маркетплейса
  происходит на сервере.

## Пример элемента фида с полной карточкой товара

Никакой правки конфига не требуется — `normalizeAdItem` сам распознаёт
эти поля в любой записи, которую вернул уже настроенный `feed`:

```json
{
  "id": "sku-42",
  "title": "Wireless Headphones Pro",
  "text": "Active noise cancelling, 30h battery.",
  "media": [
    { "kind": "video", "url": "https://cdn.example.com/sku-42/demo.mp4" },
    { "url": "https://cdn.example.com/sku-42/angle-1.jpg" },
    { "url": "https://cdn.example.com/sku-42/angle-2.jpg" }
  ],
  "price": { "amount": 79.99, "currency": "USD", "originalAmount": 129.99 },
  "ctas": [
    { "id": "buy", "kind": "buy", "label": "Buy now" },
    { "id": "cart", "kind": "cart", "label": "Add to cart" },
    { "id": "ask", "kind": "chat", "label": "Ask the assistant" }
  ],
  "specs": { "Battery": "30h", "Weight": "250g", "Bluetooth": "5.3" },
  "clickUrl": "https://acme-marketplace.example/item/sku-42"
}
```

## API (браузер ⇄ хост)

| Метод | Путь                 | Назначение                                       |
|-------|----------------------|---------------------------------------------------|
| GET   | `/api/ad/sources`    | Список источников (без credentials)               |
| GET/POST | `/api/ad/next`    | Следующий элемент ленты активного источника        |
| POST  | `/api/ad/refresh`    | Принудительно обновить ленту источника             |
| POST  | `/api/ad/click`      | Телеметрия клика (расширяется под нужный лог)      |
| POST  | `/api/ad/chat`       | Один ход чата с ассистентом источника (не-стриминг)|
| POST  | `/api/ad/chat/stream`| Тот же чат, ответ — поток SSE-дельт (v0.2)         |
| GET   | `/api/ad/cart`       | Текущее содержимое корзины + сумма (v0.2)          |
| POST  | `/api/ad/cart/add`   | Добавить элемент текущей ленты в корзину (v0.2)    |
| POST  | `/api/ad/cart/qty`   | Изменить количество строки корзины (v0.2)          |
| POST  | `/api/ad/cart/remove`| Убрать строку из корзины (v0.2)                    |
| POST  | `/api/ad/cart/clear` | Очистить корзину (v0.2)                            |

## Что не сделано (осознанно, вне рамок этого патча)

- Нет полного набора тестов (`*.test.ts`), как в оригинальном `dsh-pet`
  (там 82 файла с параллельными `*.test.ts`) — добавляются по тому же
  паттерну (vitest) при необходимости.
- `cordis.patch.yml` для автоматической вставки плагина в `dsh plugin`
  не включён — добавьте по образцу `dsh-pet/cordis.patch.yml`, если плагин
  ставится через семейный бандл, а не `dsh plugin --profile web add`.
