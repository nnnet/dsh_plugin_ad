/**
 * Tiny dot-path utility used by the adapter's `mapping` config and by the
 * click-through template substitution. Kept in its own file so a custom
 * source adapter can `import { getPath }` without pulling the whole
 * adapter (with its React-free host-only types) into the client bundle.
 * @module dsh_plugin_ad/mapping
 */

/** Walk a dot path into a JSON-like value. Arrays can be indexed with digits. */
export function getPath(value: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  let current: unknown = value
  for (const part of path.split('.')) {
    if (part === '') continue
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)]
    else if (typeof current === 'object' && current !== null) current = (current as Record<string, unknown>)[part]
    else return undefined
  }
  return current
}

/**
 * Recursive `{{path.to.value}}` template substitution. Walks an object
 * graph and substitutes string leaves in place. Non-string leaves are
 * returned as-is; substitution misses substitute the empty string.
 */
export function renderTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_, path) => String(getPath(context, path) ?? ''))
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, context))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, context)]))
  }
  return value
}
