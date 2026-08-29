/**
 * English UI copy for dsh-ad. Mirrored verbatim by `zh.ts` — every key here
 * must exist there (and vice versa). The union of both is the source of
 * truth: add a new key to *both* files in the same change, then reference
 * it via `t()` from the host (settings page) or `client/locales.ts` (widget).
 * @module dsh_plugin_ad/locales/en
 */

export const en = {
  // Settings section (host).
  'settings.title': 'Ads',
  'settings.description': 'Choose an ad source and whether the widget is shown.',
  'settings.enabled': 'Enable ads',
  'settings.enabledHint': 'When off, the widget hides and polling stops.',
  'settings.visible': 'Show the widget',
  'settings.visibleHint': 'When off, the widget hides but polling continues in the background.',
  'settings.activeSource': 'Ad source',
  'settings.activeSourceHint': "Which configured source supplies the widget's content.",
  'settings.noSources': 'No ad sources are configured. Add one under `sources` in the plugin config.',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',

  // Source picker diagnostics.
  'source.disabled': 'Disabled',
  'source.noAuth': 'No credentials configured (public feed).',
  'source.usingEnv': 'Credentials read from environment.',
  'source.usingPlain': 'Credentials are inlined in the config file.',
  'source.streamingChat': 'Streaming chat enabled.',
  'source.staticChat': 'Non-streaming chat (one JSON reply per turn).',

  // Content type labels (also used in source picker).
  'type.video': 'Video',
  'type.gif': 'GIF',
  'type.image': 'Image',
  'type.text': 'Text',
  'type.message': 'Message',
  'type.chat': 'Chat',
  'type.product': 'Product',
  'type.html': 'HTML',
  'type.card': 'Card',
  'type.raw': 'Raw',
} as const
