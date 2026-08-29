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
  'ad.widget.dismiss': 'Dismiss',
  'ad.widget.openLink': 'Visit',
  'ad.widget.sourcePicker': 'Source',
  'ad.widget.clickHint': 'Click to open',
  'ad.widget.eligible': 'Eligible',
  'ad.widget.ineligibleFrequency': 'Hidden: impression cap reached.',
  'ad.widget.ineligibleTargeting': 'Hidden: targeting rules do not match.',
  'ad.widget.itemCount': '{n} in rotation',

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
} as const
