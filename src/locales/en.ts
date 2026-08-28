/**
 * English copy for the ad plugin. Keep in lockstep with zh.ts: every key
 * here must exist there too (and vice versa) — see locales/index.ts's AdKey.
 * @module @linxin666/dsh-ad/locales/en
 */
export const en = {
  // Widget chrome.
  'ad.widget.title': 'Sponsored',
  'ad.widget.loading': 'Loading…',
  'ad.widget.empty': 'No ads available right now.',
  'ad.widget.error': 'Could not load the ad feed.',
  'ad.widget.refresh': 'Refresh',
  'ad.widget.dismiss': 'Dismiss',
  'ad.widget.openLink': 'Visit',
  'ad.widget.sourcePicker': 'Source',
  'ad.widget.clickHint': 'Click to open',

  // Chat surface.
  'ad.chat.title': 'Ask the assistant',
  'ad.chat.placeholder': 'Ask about this product…',
  'ad.chat.send': 'Send',
  'ad.chat.sending': 'Sending…',
  'ad.chat.error': 'The assistant could not respond. Please try again.',
  'ad.chat.emptyState': 'Ask a question about this product to get started.',
  'ad.chat.unavailable': 'This source does not offer a chat assistant.',
  'ad.chat.streaming': 'typing…',

  // Product card (v0.2): carousel, price/discount, CTAs, details.
  'ad.product.discount': '-{percent}%',
  'ad.product.priceFree': 'Free',
  'ad.product.mediaPrev': 'Previous image',
  'ad.product.mediaNext': 'Next image',
  'ad.product.detailsToggle': 'Details',
  'ad.product.specs': 'Specifications',
  'ad.cta.buy': 'Buy now',
  'ad.cta.cart': 'Add to cart',
  'ad.cta.link': 'Learn more',
  'ad.cta.chat': 'Ask the assistant',

  // Cart.
  'ad.cart.title': 'Cart',
  'ad.cart.empty': 'Your cart is empty.',
  'ad.cart.added': 'Added to cart',
  'ad.cart.remove': 'Remove',
  'ad.cart.qty': 'Qty',
  'ad.cart.total': 'Total',
  'ad.cart.clear': 'Clear cart',
  'ad.cart.checkoutHint': 'Checkout happens on the marketplace site.',

  // Content-type labels (used in the source picker / diagnostics).
  'ad.type.video': 'Video',
  'ad.type.gif': 'GIF',
  'ad.type.image': 'Image',
  'ad.type.text': 'Text',
  'ad.type.message': 'Message',
  'ad.type.chat': 'Chat',

  // Settings section.
  'settings.title': 'Ads',
  'settings.description': 'Choose an ad source and whether the widget is shown.',
  'settings.enabled': 'Enable ads',
  'settings.enabledHint': 'When off, the widget hides and polling stops.',
  'settings.visible': 'Show the widget',
  'settings.visibleHint': 'When off, the widget hides but polling continues in the background.',
  'settings.activeSource': 'Ad source',
  'settings.activeSourceHint': 'Which configured source supplies the widget\'s content.',
  'settings.noSources': 'No ad sources are configured. Add one under `sources` in the plugin config.',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
} as const
