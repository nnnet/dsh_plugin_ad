/**
 * dsh-ad — host / API diagnostic strings. Every non-localized string the
 * server emits (errors, log lines, route 4xx/5xx bodies) lives here so a
 * future i18n push can swap them out without grepping the source tree.
 * User-facing UI copy is deliberately kept in `src/locales/*.ts`.
 * @module dsh_plugin_ad/messages
 */

export const ERRORS = {
  noSourcesConfigured: 'no ad sources are configured',
  sourceIdUnknown: (id: string): string => `unknown ad source: ${id}`,
  sourceMissingFeed: (id: string): string => `source '${id}' has no feed endpoint configured`,
  sourceMissingChat: (id: string): string => `source '${id}' has no chat endpoint configured`,
  itemNotInFeed: (itemId: string, sourceId: string): string =>
    `item '${itemId}' is not in the current '${sourceId}' feed`,
  chatResponseMissingReply: (id: string): string => `source '${id}' chat response did not contain a reply`,
  chatStreamingUnavailable: (id: string): string => `source '${id}' has no streaming chat configured`,
  bodyInvalidJson: 'invalid JSON body',
  bodyInvalidKey: (key: string): string => `invalid-${key}`,
  bodyTooLarge: 'body too large',
  methodNotAllowed: 'method-not-allowed',
  endpointNon2xx: (host: string, status: number): string => `ad endpoint ${host} responded ${status}`,
  endpointNoStreamBody: (host: string): string => `ad endpoint ${host} returned no stream body`,
  endpointTimeout: (ms: number): string => `ad endpoint timed out after ${ms}ms`,
  hostNotAllowed: (host: string): string => `ad source host not in allowlist: ${host}`,
  urlProtocol: (proto: string): string => `ad source URL protocol must be http(s); got ${proto}`,
  privateNetworkDisabled: (host: string): string => `ad source URL points at a private network: ${host}`,
  responseTooLarge: (cap: number): string => `ad source response exceeded cap (${cap} bytes)`,
  configMissingSource: 'config: source referenced but not present in sources[]',
  configInvalidType: (got: string): string => `config: invalid content type: ${got}`,
} as const
