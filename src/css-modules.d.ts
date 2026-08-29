/**
 * Ambient declarations so TypeScript understands CSS-Modules imports.
 * Every `*.module.css` file in `src/client/` exports a `Record<string, string>`
 * mapping camelCased class names to the original kebab-cased CSS class.
 * The bundler (tsdown) inlines the modules and replaces `styles.foo` with the
 * real class name; TypeScript only needs the shape to type-check imports.
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
