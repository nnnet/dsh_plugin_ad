/**
 * English UI copy for the dsh-ad widget. Mirrored verbatim by `zh.ts` —
 * every key here must exist there (and vice versa). The union of both is
 * the source of truth: add a new key to *both* files in the same change,
 * then reference it via `t()`.
 * @module dsh_plugin_ad/client/locales/en
 */

export const en = {
  // Widget chrome.
  'ad.widget.title': 'Sponsored',
  'ad.widget.loading': 'Loading…',
  'ad.widget.empty': 'No ads available right now.',
  'ad.widget.error': 'Could not load the ad feed.',
  'ad.widget.refresh': 'Refresh',
  'ad.widget.videoUnavailable': 'This video could not be loaded.',
  'ad.widget.dismiss': 'Dismiss',
  'ad.widget.openLink': 'Visit',
  'ad.widget.sourcePicker': 'Source',
  'ad.widget.clickHint': 'Click to open',
  'ad.widget.eligible': 'Eligible',
  'ad.widget.ineligibleFrequency': 'Hidden: impression cap reached.',
  'ad.widget.ineligibleTargeting': 'Hidden: targeting rules do not match.',
  'ad.widget.itemCount': '{n} in rotation',
  'ad.widget.navPrev': 'Previous ad',
  'ad.widget.navNext': 'Next ad',
  'ad.widget.resizeHint': 'Resize widget',

  // Chat surface.
  'ad.chat.title': 'Ask the assistant',
  'ad.chat.placeholder': 'Ask about this product…',
  'ad.chat.send': 'Send',
  'ad.chat.sending': 'Sending…',
  'ad.chat.error': 'The assistant could not respond. Please try again.',
  'ad.chat.emptyState': 'Ask a question about this product to get started.',
  'ad.chat.unavailable': 'This source does not offer a chat assistant.',
  'ad.chat.streaming': 'typing…',

  // Product card (marketplace renderer): carousel, price/discount, CTAs, details.
  'ad.product.discount': '-{percent}%',
  'ad.product.priceFree': 'Free',
  'ad.product.mediaPrev': 'Previous image',
  'ad.product.mediaNext': 'Next image',
  'ad.product.detailsToggle': 'Details',
  'ad.product.specs': 'Specifications',
  'ad.product.galleryCount': '{count} media',
  'ad.product.outOfStock': 'Out of stock',
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

  // Content-type labels.
  'ad.type.video': 'Video',
  'ad.type.gif': 'GIF',
  'ad.type.image': 'Image',
  'ad.type.text': 'Text',
  'ad.type.message': 'Message',
  'ad.type.chat': 'Chat',
  'ad.type.product': 'Product',
  'ad.type.html': 'HTML',
  'ad.type.card': 'Card',
  'ad.type.raw': 'Raw',

  // Settings card (host shell passes these through the ad namespace's
  // TranslateNS so the card can resolve `t('settings.title')` etc.).
  // Mirrors dsh-pet's pet namespace dictionary shape.
  'settings.title': 'Ads',
  'settings.description': 'Choose an ad source, then position the widget the same way the pet is positioned.',
  'settings.enabled': 'Enable ads',
  'settings.enabledHint': 'When off, the widget hides and polling stops.',
  'settings.visible': 'Show the widget',
  'settings.visibleHint': 'When off, the widget hides but polling continues in the background.',
  'settings.decoration': 'Show campaign badge',
  'settings.decorationHint': 'When on, the widget shows a small campaign label in the corner.',
  'settings.source': 'Ad source',
  'settings.sourceHint': 'Which configured source supplies the widget’s content.',
  'settings.size': 'Width (px)',
  'settings.sizeHint': 'Widget width in px, range 200–800.',
  'settings.right': 'Right inset (px)',
  'settings.rightHint': 'Distance from the viewport right edge, in px.',
  'settings.bottom': 'Bottom inset (px)',
  'settings.bottomHint': 'Distance from the viewport bottom edge, in px.',
  'settings.rotation': 'Rotation interval (ms)',
  'settings.rotationHint': 'How long each card is shown before the next one. 1000–600000 ms (1 s – 10 min).',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.invalidNumber': 'Please enter a number; leave empty to use the default.',
  'settings.notExposed': 'This DSH deployment does not expose the ad settings namespace to the Settings page.',
  'settings.readOnly': 'The current deployment is read-only.',
  'settings.expand': 'Expand settings',
  'settings.collapse': 'Collapse settings',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
} as const
