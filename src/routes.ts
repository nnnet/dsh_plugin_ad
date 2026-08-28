/**
 * dsh-ad HTTP routes — same-origin JSON API the browser widget talks to.
 * Every route answers from the AdService, which holds credentials; nothing
 * secret ever reaches these handlers or the response bodies they write.
 * @module @linxin666/dsh-ad/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { AdService } from './service.ts'
import { readJsonBody, writeJson } from './http.ts'

/** Browser-facing base path of the ad API. */
export const AD_API_PREFIX = '/api/ad'

function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

function getRoute(path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      run().then((value) => writeJson(res, 200, value), (error) => {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

function postRoute(path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      return readJsonBody(req, { maxBytes: 64 * 1024 }).then((parsed) => {
        const payload = parsed ?? {}
        const record = (typeof payload === 'object' && payload !== null) ? payload as Record<string, unknown> : {}
        return run(record).then(
          (value) => writeJson(res, 200, value),
          (error) => {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          },
        )
      }, (error) => {
        writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value === '') throw new Error(`invalid-${key}`)
  return value
}

/** Build the ad plugin's full route family. */
export function makeAdRoutes(deps: { service: AdService; ctx: Context }): WebRoute[] {
  const { service } = deps

  return [
    // Credential-free list of configured sources, for the widget's picker.
    getRoute(AD_API_PREFIX + '/sources', () => Promise.resolve(service.listSources())),

    // Next item in the active (or explicitly requested) source's rotation.
    getRoute(AD_API_PREFIX + '/next', () => {
      const sourceId = service.defaultSourceId()
      if (sourceId === undefined) return Promise.resolve({ ok: false, error: 'no-sources-configured' })
      const item = service.nextItem(sourceId)
      if (item === undefined) return Promise.resolve({ ok: true, item: null })
      const clickUrl = service.resolveClickThrough(sourceId, item)
      return Promise.resolve({ ok: true, item: { ...item, clickUrl } })
    }),

    postRoute(AD_API_PREFIX + '/next', (body) => {
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId : service.defaultSourceId()
      if (sourceId === undefined) return Promise.reject(new Error('no-sources-configured'))
      const item = service.nextItem(sourceId)
      if (item === undefined) return Promise.resolve({ ok: true, item: null })
      const clickUrl = service.resolveClickThrough(sourceId, item)
      return Promise.resolve({ ok: true, item: { ...item, clickUrl } })
    }),

    // Manual feed refresh (e.g. a "reload" affordance in the widget).
    postRoute(AD_API_PREFIX + '/refresh', (body) => {
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId : service.defaultSourceId()
      if (sourceId === undefined) return Promise.reject(new Error('no-sources-configured'))
      return service.forceRefresh(sourceId).then(() => ({ ok: true }))
    }),

    // Fire-and-forget click telemetry hook; expand with real logging as needed.
    postRoute(AD_API_PREFIX + '/click', (body) => {
      const itemId = requireString(body, 'itemId')
      return Promise.resolve({ ok: true, itemId })
    }),

    // Chat turn proxied to the source's AI-assistant endpoint.
    postRoute(AD_API_PREFIX + '/chat', (body) => {
      const message = requireString(body, 'message')
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId : service.defaultSourceId()
      if (sourceId === undefined) return Promise.reject(new Error('no-sources-configured'))
      const history = readHistory(body)
      return service.chat(sourceId, message, history).then((reply) => ({ ok: true, reply }))
    }),

    // Streaming chat turn: raw route (not the JSON-envelope helpers above)
    // so it can flush the response as an SSE stream instead of one JSON
    // body at the end. Falls back to a single `event: error` frame if the
    // source has no streaming chat configured or the upstream call fails.
    {
      kind: 'exact',
      path: AD_API_PREFIX + '/chat/stream',
      handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!requireMethod(req, res, 'POST')) return Promise.resolve()
        return readJsonBody(req, { maxBytes: 64 * 1024 }).then(async (parsed) => {
          const payload = parsed ?? {}
          const body = (typeof payload === 'object' && payload !== null) ? payload as Record<string, unknown> : {}
          const message = typeof body.message === 'string' ? body.message : undefined
          const sourceId = typeof body.sourceId === 'string' ? body.sourceId : service.defaultSourceId()

          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          })

          if (message === undefined || sourceId === undefined || !service.supportsChatStream(sourceId)) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'streaming-not-available' })}\n\n`)
            res.end()
            return
          }

          try {
            await service.chatStream(sourceId, message, readHistory(body), (delta) => {
              res.write(`data: ${JSON.stringify({ delta })}\n\n`)
            })
            res.write('event: done\ndata: {}\n\n')
          } catch (error) {
            const message2 = error instanceof Error ? error.message : String(error)
            res.write(`event: error\ndata: ${JSON.stringify({ error: message2 })}\n\n`)
          } finally {
            res.end()
          }
        }, () => {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'invalid-body' }))
        })
      },
    },

    // --- Cart (local mirror; see cart.ts) --------------------------------
    getRoute(AD_API_PREFIX + '/cart', () => {
      const sourceId = service.defaultSourceId()
      if (sourceId === undefined) return Promise.resolve({ ok: true, lines: [], total: undefined })
      return Promise.resolve({ ok: true, lines: service.cartList(sourceId), total: service.cartTotal(sourceId) })
    }),

    postRoute(AD_API_PREFIX + '/cart/add', (body) => {
      const itemId = requireString(body, 'itemId')
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId : service.defaultSourceId()
      if (sourceId === undefined) return Promise.reject(new Error('no-sources-configured'))
      const qty = typeof body.qty === 'number' && body.qty > 0 ? body.qty : 1
      const lines = service.cartAdd(sourceId, itemId, qty)
      return Promise.resolve({ ok: true, lines, total: service.cartTotal(sourceId) })
    }),

    postRoute(AD_API_PREFIX + '/cart/qty', (body) => {
      const itemId = requireString(body, 'itemId')
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId : service.defaultSourceId()
      if (sourceId === undefined) return Promise.reject(new Error('no-sources-configured'))
      const qty = typeof body.qty === 'number' ? body.qty : 0
      const lines = service.cartSetQty(sourceId, itemId, qty)
      return Promise.resolve({ ok: true, lines, total: service.cartTotal(sourceId) })
    }),

    postRoute(AD_API_PREFIX + '/cart/remove', (body) => {
      const itemId = requireString(body, 'itemId')
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId : service.defaultSourceId()
      if (sourceId === undefined) return Promise.reject(new Error('no-sources-configured'))
      const lines = service.cartRemove(sourceId, itemId)
      return Promise.resolve({ ok: true, lines, total: service.cartTotal(sourceId) })
    }),

    postRoute(AD_API_PREFIX + '/cart/clear', (body) => {
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId : service.defaultSourceId()
      if (sourceId === undefined) return Promise.reject(new Error('no-sources-configured'))
      const lines = service.cartClear(sourceId)
      return Promise.resolve({ ok: true, lines, total: undefined })
    }),
  ]
}

function readHistory(body: Record<string, unknown>): Array<{ role: string; content: string }> {
  return Array.isArray(body.history)
    ? (body.history as unknown[]).filter(
      (m): m is { role: string; content: string } =>
        typeof m === 'object' && m !== null
        && typeof (m as Record<string, unknown>).role === 'string'
        && typeof (m as Record<string, unknown>).content === 'string',
    )
    : []
}
