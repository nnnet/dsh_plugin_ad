/**
 * Build config for dsh-ad.
 *
 * Two entry points with different output contracts, so they are two configs:
 *   - `src/index.ts`         — host half: an ordinary Node ESM bundle.
 *   - `src/client/index.tsx` — browser half: a dsh client-plugin bundle, which
 *     is NOT a module. The dsh loader fetches it with a classic `<script src>`
 *     and expects the file to call `window.__ModuleLoader__.load({id, factory})`,
 *     resolving its externals through the `require` passed into the factory.
 *     Any ESM syntax or unresolvable bare specifier there fails the whole web
 *     shell (a blank page), while the host keeps answering HTTP 200.
 *
 * Output:
 *   lib/index.js, lib/client.js  — runtime JS bundles
 *   lib/types/                    — .d.ts from `tsc -b`
 *
 * `tsc -b` runs first via the package.json `build` script and emits the
 * declaration tree to `lib/types/`. `tsdown` then bundles the JS only
 * (`dts: false`) — dts generation is owned by the host tsconfig, not by
 * rolldown-plugin-dts, which crashes on multi-entry dts shapes. The
 * `package.json#exports` map points to both trees.
 *
 * This file deliberately depends on nothing from the harness repository: the
 * dsh client preset lives at `packages/client/tsdown.client.ts` inside dsh and
 * imports its neighbours by relative path, so it is unusable from outside.
 * Only the loader contract is mirrored here.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Registration key of this plugin; must equal the package name the host mounts. */
const PLUGIN_ID = 'dsh_plugin_ad'

/**
 * Specifiers the client bundle may leave as `require(...)`.
 *
 * The loader answers exactly two groups: the shell's platform table (react and
 * friends, plus the preloaded client runtime) and the rows a package requests
 * through `dsh.client.external`. Everything else MUST be inlined — a
 * `require()` the table cannot answer is a runtime throw, not a resolution
 * fallback, and an inlined copy of a shared package is a second runtime
 * instance the shell will not recognize.
 *
 * This list is the platform baseline only: the client half imports
 * `@deepseek-ai/dsh-client-runtime/client` and `.../dsh-client-ui-settings/client`
 * with `import type`, so neither survives to runtime and neither needs a
 * declared graph edge. A package-specific row belongs here and in
 * `dsh.client.external` together, once something imports it as a value.
 */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

const isClientExternal = (specifier: string): boolean => CLIENT_EXTERNALS.has(specifier)

/**
 * Virtual id wrapper keeping CSS out of tsdown's own css pipeline, which
 * demands `@tsdown/css` for any id ending in `.css`. The `.mjs` suffix is what
 * keeps that guard from matching.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-ad-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Compile one CSS Modules file into a module that injects its stylesheet and
 * exports the hashed class map.
 *
 * The injection has to happen while the factory runs: the loader claims the
 * `<style>` tags that appear during materialization and attributes them to this
 * plugin, which is also what lets it drop them when the plugin unloads. A
 * separate `lib/style.css` emitted next to the bundle would never be linked.
 */
function styleModule(fileId: string, css: string, classMap: Record<string, string>): string {
  const tagId = `${PLUGIN_ID}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

/** Rolldown plugin turning `*.module.css` imports into style-injecting modules. */
const cssModulesPlugin = {
  name: 'dsh-ad-css-modules',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    const resolved = importer === undefined
      ? source
      : new URL(source, `file://${importer}`).pathname
    return `${CSS_VIRTUAL_PREFIX}${resolved}${CSS_VIRTUAL_SUFFIX}`
  },
  load(id: string) {
    if (!id.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = id.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    const { code, exports } = transform({
      filename: fileId,
      code: readFileSync(fileId),
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    for (const [local, exported] of Object.entries(exports ?? {})) classMap[local] = exported.name
    return styleModule(fileId, code.toString(), classMap)
  },
}

/** Host half: ordinary Node ESM, loaded by the harness through `main`. */
const host = {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm' as const,
  // `package.json#exports` points at `lib/*.js`, and `"type": "module"` already
  // makes a bare `.js` ESM. Without this the ESM format emits `.mjs`, the
  // manifest keeps resolving whatever stale `.js` an earlier build left behind
  // (`clean: false` preserves the `tsc -b` type tree, so nothing removes them),
  // and the host silently loads dead code.
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  clean: false,
  target: 'es2022',
  platform: 'node' as const,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-settings',
      'js-yaml',
      'schemastery',
    ],
  },
}

/** Browser half: a loader-registered closure factory, not a module. */
const client = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  // CJS is what makes externals come out as `require(...)` calls for the
  // factory's injected require. The banner/footer below wrap that body.
  format: 'cjs' as const,
  platform: 'browser' as const,
  // Types ship from lib/types via `tsc -b`; emitting dts here would wrap the
  // banner and footer into a .d.cts and break its parsing.
  dts: false,
  sourcemap: true,
  // The host half emitted above lands in the same directory, and `lib/types`
  // comes from `tsc -b` — a clean would wipe both.
  clean: false,
  target: 'es2022',
  deps: {
    neverBundle: isClientExternal,
    alwaysBundle: (specifier: string) => !isClientExternal(specifier),
  },
  // A CJS output carries no `import.meta`, and browser-facing dependencies
  // routinely probe it alongside `process.env.NODE_ENV`; without these
  // substitutions the factory throws at load.
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [cssModulesPlugin],
  outputOptions: {
    // Pinned: a CJS format would otherwise emit `client.cjs` and diverge from
    // the `./client` entry in `package.json#exports`.
    entryFileNames: 'client.js',
    // The CJS body writes to `exports` and the footer reads `module.exports`,
    // but a factory arrow function is not a CJS module wrapper — nothing binds
    // either name in that scope. Declaring both here is what makes the emitted
    // body legal; without them the bundle throws ReferenceError the moment the
    // loader materializes it.
    banner: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      'var module = { exports: {} };',
      'var exports = module.exports;',
    ].join('\n'),
    footer: 'return module.exports; } });',
  },
}

export default defineConfig([host, client])
