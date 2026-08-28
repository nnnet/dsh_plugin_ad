/** Host/API diagnostic strings. UI copy is deliberately kept in src/locales/. */
export const ERRORS = {
  sourceUrlProtocol: 'source URL must use http or https',
  sourceHostNotAllowed: 'source host is not allowed',
  privateNetworkDisabled: 'private-network source is disabled',
  responseTooLarge: 'response exceeds configured size limit',
  unknownSource: 'unknown advertising source',
  unknownAction: 'unknown advertising action',
  assistantNotConfigured: 'AI assistant is not configured for this advertising source',
  missingSourceAndAction: 'sourceId and actionId are required',
  missingChatFields: 'sourceId and message are required',
  methodNotAllowed: 'method-not-allowed',
  missingMediaArguments: 'source and url are required',
} as const
