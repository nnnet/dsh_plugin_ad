/**
 * Minimal in-memory cart, kept per ad source. The plugin follows the same
 * loopback-only, single-desktop-user model as dsh-pet (no multi-tenant auth
 * layer at this level), so a process-lifetime in-memory map is enough — it
 * resets on host restart like the rest of the widget's runtime state.
 * Persisting the cart into the buyer's real marketplace account is a
 * source-specific concern and belongs behind a 'buy'/'cart' CTA's own
 * endpoint, not this local mirror.
 * @module dsh_plugin_ad/cart
 */

import type { AdItem } from './adapter.ts'

export interface CartLine {
  itemId: string
  title?: string
  price?: AdItem['price']
  mediaUrl?: string
  qty: number
}

export class CartStore {
  private carts = new Map<string, Map<string, CartLine>>()

  private cartFor(sourceId: string): Map<string, CartLine> {
    let cart = this.carts.get(sourceId)
    if (cart === undefined) {
      cart = new Map()
      this.carts.set(sourceId, cart)
    }
    return cart
  }

  add(sourceId: string, item: AdItem, qty = 1): CartLine[] {
    const cart = this.cartFor(sourceId)
    const existing = cart.get(item.id)
    const nextQty = (existing?.qty ?? 0) + qty
    cart.set(item.id, {
      itemId: item.id,
      title: item.title,
      price: item.price,
      mediaUrl: item.mediaUrl,
      qty: nextQty,
    })
    return this.list(sourceId)
  }

  remove(sourceId: string, itemId: string): CartLine[] {
    this.cartFor(sourceId).delete(itemId)
    return this.list(sourceId)
  }

  setQty(sourceId: string, itemId: string, qty: number): CartLine[] {
    const cart = this.cartFor(sourceId)
    if (qty <= 0) {
      cart.delete(itemId)
    } else {
      const existing = cart.get(itemId)
      if (existing !== undefined) cart.set(itemId, { ...existing, qty })
    }
    return this.list(sourceId)
  }

  clear(sourceId: string): CartLine[] {
    this.cartFor(sourceId).clear()
    return []
  }

  list(sourceId: string): CartLine[] {
    return [...this.cartFor(sourceId).values()]
  }

  total(sourceId: string): { amount: number; currency: string } | undefined {
    const lines = this.list(sourceId).filter((l) => l.price !== undefined)
    if (lines.length === 0) return undefined
    const currency = lines[0].price?.currency ?? 'USD'
    const amount = lines.reduce((sum, l) => sum + (l.price?.amount ?? 0) * l.qty, 0)
    return { amount, currency }
  }
}
