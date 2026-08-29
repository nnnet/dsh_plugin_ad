# Самодостаточная сборка клиентского бандла `dsh_plugin_ad`

## Контекст

Хостовая половина плагина работает: запись `ad` монтируется, маршруты регистрируются, `POST /api/ad/next` и `/api/ad/sources` отвечают. Сломан только клиентский бандл, и он роняет **всё** веб-приложение в белую страницу.

Причина: `lib/client.js` собран обычным ESM и начинается с

```js
import { createElement, ... } from "react";
import { createRoot } from "react-dom/client";
```

Загрузчик dsh тянет бандл классическим `<script src>` (`defaultLoadBundle`, `packages/client/modules/src/client/system.ts`), поэтому ESM-синтаксиса там быть не может в принципе, а bare-спецификатор `"react"` браузеру разрешить нечем — import map в dsh не используется. Модуль падает при загрузке и убивает шелл. Хост при этом здоров и отдаёт HTTP 200, поэтому со стороны сервера поломка невидима.

Цель: собирать клиентскую половину в формат загрузчика, не завися от внутренностей харнесса — пресет `packages/client/tsdown.client.ts` лежит внутри репозитория dsh и импортирует по относительным путям (`./web/src/platform.ts`, `../../scripts/client-build-environment.ts`), опубликованного пакета с ним нет. Плагин должен собираться сам, только из публичных npm-зависимостей.

Сейчас запись `ad` временно отключена в `~/.dsh/profiles/web/cordis.patch.yml`, чтобы вернуть UI.

## Требуемый контракт

`ClientBundleRegistration` (`packages/client/modules/src/client/manifest.ts:191`):

```ts
{ id: string, factory: (require: (spec: string) => unknown) => Record<string, unknown> }
```

Эталонная обёртка (`packages/client/tsdown.client.ts:562`):

```js
window.__ModuleLoader__.load({ id: "<pkg>", factory: (require) => {
  /* тело CJS-бандла */
return module.exports; } });
```

Разрешимые через `require` (`packages/client/web/src/platform.ts`): `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, плюс `@deepseek-ai/dsh-client-runtime/client`.

**Жёсткое правило:** внешним остаётся только то, что реально есть в таблице модулей; всё остальное обязано инлайниться. `require()`, на который таблица не может ответить, — гарантированный бросок в рантайме.

Клиент плагина импортирует извне ровно четыре вещи: `react`, `react-dom/client`, `@deepseek-ai/dsh-client-runtime/client`, `@deepseek-ai/dsh-client-ui-settings/client`. Первые три покрыты базовой таблицей; четвёртая — нет.

## План

### 1. `package.json` — объявить внешние модули

Добавить в `dsh.client` ключ `external`:

```json
"external": ["@deepseek-ai/dsh-client-ui-settings/client"]
```

Существующий `inject` оставить: по `manifest.ts:45-48` это «informational graph declaration», он **не** влияет на доставку кода, а рёбра модульного графа задаёт именно `external`. Сейчас в плагине объявлен только `inject`, поэтому `dsh-client-ui-settings/client` ниоткуда не резолвится.

Добавить devDependency `lightningcss` (^1.32) — публичный пакет, тот же, что использует харнесс.

### 2. `tsdown.config.ts` — разделить на два конфига

Сейчас один конфиг с `platform: 'node'` и обоими входами, из-за чего клиент собирается как node-ESM. Заменить на `defineConfig([host, client])`.

**host** — как сейчас: `entry: { index: 'src/index.ts' }`, `format: 'esm'`, `platform: 'node'`, `outDir: 'lib'`, `outExtensions: () => ({ js: '.js' })`, `dts: false`, `clean: false`.

**client** — по образцу `clientConfig()` (`packages/client/tsdown.client.ts:437-478`):

- `entry: { client: 'src/client/index.tsx' }`, `outDir: 'lib'`, `format: 'cjs'`, `platform: 'browser'`
- `dts: false` — иначе banner/footer попадут в `.d.cts` и сломают разбор
- `sourcemap: true`, `clean: false` (иначе снесёт вывод host-половины и дерево `lib/types`)
- `deps.neverBundle` — множество внешних; `deps.alwaysBundle` — всё остальное
- `define`: `process.env.NODE_ENV`, `import.meta.env.MODE`, `import.meta.env` — CJS не несёт `import.meta`, без подстановок фабрика падает на `ReferenceError`
- `outputOptions.banner` / `footer` — обёртка выше; `entryFileNames: 'client.js'` закрепить явно, иначе CJS даст `client.cjs` и разъедется с `exports`

### 3. CSS Modules — небольшой rolldown-плагин в том же конфиге

`ad.module.css` импортируется девятью файлами как `styles.*`, значит нужны и карта классов, и инжект стилей. Текущая сборка кладёт отдельный `lib/style.css`, который никто не подключает.

Воспроизвести подход пресета (`tsdown.client.ts:34-52`, `:511-514`): перехватывать `*.module.css`, компилировать `lightningcss.transform({ filename, code, cssModules: { pattern: '[hash]_[local]' } })` и отдавать модуль, который

1. создаёт `<style>` с `dataset.plugin = "dsh_plugin_ad"` и `dataset.pluginCss`, если такого тега ещё нет, и
2. дефолт-экспортирует карту классов.

Инжект обязан происходить **внутри** фабрики: загрузчик присваивает плагину теги, появившиеся при материализации (`claimStyles`, `system.ts:34`). Виртуальный id не должен оканчиваться на `.css` — гард tsdown требует `@tsdown/css` для таких id.

### 4. Включить обратно

Убрать `- id: ad / disabled: true` из `~/.dsh/profiles/web/cordis.patch.yml` (блок помечен комментарием) и перезапустить.

## Проверка

Собранный артефакт — до запуска:

```sh
head -c 120 lib/client.js                  # начинается с window.__ModuleLoader__.load({
grep -cE '^import |^export ' lib/client.js # 0 — ESM-синтаксиса быть не должно
grep -oE 'require\("[^"]+"\)' lib/client.js | sort -u   # только модули из таблицы
```

Ожидаемый список `require`: `react`, `react/jsx-runtime`, `react-dom/client`, `@deepseek-ai/dsh-client-runtime/client`, `@deepseek-ai/dsh-client-ui-settings/client`. Любой другой `@deepseek-ai/*` или сторонний пакет в этом списке — ошибка: он обязан быть заинлайнен.

Живая проверка:

```sh
setsid nohup env DSH_SKIP_BUILD=1 ~/.dsh/start-web.sh > ~/.dsh/web-start.log 2>&1 < /dev/null &
curl -s http://127.0.0.1:3080/plugins/dsh_plugin_ad/client.js | head -c 80
```

Критерий приёмки — **страница рендерится** (не белая) и в консоли браузера нет ошибок загрузки модулей. HTTP 200 сам по себе ничего не доказывает: белая страница отдавалась именно с 200.

## Что этим не чинится

- **Виджет останется пустым, пока не заданы источники.** Сейчас `/api/ad/sources` возвращает `[]`, и `AdWidget` при пустом списке не рисует ничего. Это конфигурация, а не поломка.
- **`example.config.yaml` загрузить нельзя.** `loadConfigFromFile` (`src/config.ts:452`) делает `JSON.parse`, YAML-парсера в зависимостях нет, а ошибка глотается в `catch { return config }` — файл молча игнорируется. Отдельная правка: либо JSON, либо парсер YAML, либо хотя бы лог в `catch`.
