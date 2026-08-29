/**
 * dsh-ad HTTP routes — same-origin JSON API the browser widget talks to.
 * Every route answers from the AdService, which holds credentials; nothing
 * secret ever reaches these handlers or the response bodies they write.
 * @module dsh_plugin_ad/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { AdService, AdRuntimeContext } from './service.ts'
import { readJsonBody, writeJson } from './http.ts'
import { API_PREFIX, JSON_BODY_MAX_BYTES } from './constants.ts'
import { ERRORS } from './messages.ts'
import { trimHistory } from './service.ts'

/** Browser-facing base path of the ad API. */
export const AD_API_PREFIX = API_PREFIX

function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  writeJson(res, 405, { ok: false, error: ERRORS.methodNotAllowed })
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
      return readJsonBody(req, { maxBytes: JSON_BODY_MAX_BYTES }).then((parsed) => {
        const payload = parsed ?? {}
        const record = (typeof payload === 'object' && payload !== null) ? payload as Record<string, unknown> : {}
        return run(record).then(
          (value) => writeJson(res, 200, value),
          (error) => {
            writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          },
        )
      }, () => {
        writeJson(res, 400, { ok: false, error: ERRORS.bodyInvalidJson })
      })
    },
  }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value === '') throw new Error(ERRORS.bodyInvalidKey(key))
  return value
}

function readRuntime(body: Record<string, unknown>): AdRuntimeContext {
  return {
    locale: typeof body.locale === 'string' ? body.locale : undefined,
    path: typeof body.path === 'string' ? body.path : undefined,
    tags: Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string') : undefined,
  }
}

function readSourceId(body: Record<string, unknown>, fallback: string | undefined): string | undefined {
  return typeof body.sourceId === 'string' ? body.sourceId : fallback
}

/** Build the ad plugin's full route family. */
export function makeAdRoutes(deps: { service: AdService; ctx: Context }): WebRoute[] {
  const { service } = deps

  return [
    // Credential-free list of configured sources, for the widget's picker.
    // Also includes the current display settings so the client can apply
    // size/position/visibility without a second round-trip.
    postRoute(AD_API_PREFIX + '/sources', (body) => {
      return Promise.resolve({
        sources: service.listSources(readRuntime(body)),
        display: service.getDisplay(),
        enabled: service.isEnabled(),
        activeSourceId: service.activeId(),
      })
    }),

    // Read-only display settings. Kept separate from /sources so a
    // future "appearance" sub-tab in the settings UI can refresh this
    // without pulling the full source list.
    getRoute(AD_API_PREFIX + '/widget-settings', () => {
      return Promise.resolve({ ok: true, display: service.getDisplay(), enabled: service.isEnabled() })
    }),

    // Pet-style drag-and-drop / display mutation. The widget fires this
    // on `pointerup` after a drag; the host clamps and persists.
    postRoute(AD_API_PREFIX + '/display', (body) => {
      const display: Record<string, unknown> = {}
      if (typeof body.visible === 'boolean') display['visible'] = body.visible
      if (typeof body.enabled === 'boolean') display['enabled'] = body.enabled
      if (typeof body.decorationEnabled === 'boolean') display['decorationEnabled'] = body.decorationEnabled
      if (typeof body.size === 'number') display['size'] = body.size
      if (typeof body.right === 'number') display['right'] = body.right
      if (typeof body.bottom === 'number') display['bottom'] = body.bottom
      service.setDisplay(display as Partial<Parameters<AdService['setDisplay']>[0]>)
      return Promise.resolve({ ok: true, display: service.getDisplay() })
    }),

    // DEBUG: feed cache introspection. Returns { id, items, lastError }
    // for each source. Not part of the stable API; for diagnosis only.
    postRoute(AD_API_PREFIX + '/debug', (body) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = service as any
      const ids: string[] = typeof svc.defaultSourceId === 'function' ? [svc.defaultSourceId()].filter(Boolean) as string[] : []
      const out = ids.map((id) => {
        const c = svc.cache?.get?.(id)
        return { id, items: c?.items?.length ?? 0, lastError: c?.lastError, cursor: c?.cursor }
      })
      return Promise.resolve({ sources: out })
    }),

    // Next item in the active (or explicitly requested) source's rotation.
    // POST only: the host webserver keys routes by (kind, path), so one path
    // holds one handler — a second GET seat here collides at registration and
    // fails the whole plugin tree. The widget posts, and an omitted sourceId
    // falls back to the configured default, which is what a GET would answer.
    postRoute(AD_API_PREFIX + '/next', (body) => {
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      const item = service.nextItem(sourceId, readRuntime(body))
      if (item === undefined) return Promise.resolve({ ok: true, item: null })
      const clickUrl = service.resolveClickThrough(sourceId, item)
      return Promise.resolve({ ok: true, item: { ...item, clickUrl } })
    }),

    // Manual feed refresh (e.g. a "reload" affordance in the widget).
    postRoute(AD_API_PREFIX + '/refresh', (body) => {
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      return service.forceRefresh(sourceId).then(() => ({ ok: true }))
    }),

    // Fire-and-forget click telemetry hook; expand with real logging as needed.
    postRoute(AD_API_PREFIX + '/click', (body) => {
      const itemId = requireString(body, 'itemId')
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId !== undefined) void service.track(sourceId, 'click', { itemId })
      return Promise.resolve({ ok: true, itemId })
    }),

    // Generic analytics sink: impression / click / conversion events.
    postRoute(AD_API_PREFIX + '/track', (body) => {
      const event = body.event
      if (event !== 'impression' && event !== 'click' && event !== 'conversion') {
        return Promise.reject(new Error('invalid-event'))
      }
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      const payload = body.payload !== null && typeof body.payload === 'object'
        ? body.payload as Record<string, unknown>
        : {}
      return service.track(sourceId, event, payload)
    }),

    // Generic action invoker: looks up the action by id on the source and
    // runs the configured endpoint with the request payload.
    postRoute(AD_API_PREFIX + '/action', (body) => {
      const actionId = requireString(body, 'actionId')
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      const payload = body.payload !== null && typeof body.payload === 'object'
        ? body.payload as Record<string, unknown>
        : {}
      return service.action(sourceId, actionId, payload)
    }),

    // Force-track an impression when the widget first shows an item.
    postRoute(AD_API_PREFIX + '/impression', (body) => {
      const itemId = requireString(body, 'itemId')
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      return service.track(sourceId, 'impression', { itemId })
    }),

    // Chat turn proxied to the source's AI-assistant endpoint.
    postRoute(AD_API_PREFIX + '/chat', (body) => {
      const message = requireString(body, 'message')
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      const history = trimHistory(readHistory(body))
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
        return readJsonBody(req, { maxBytes: JSON_BODY_MAX_BYTES }).then(async (parsed) => {
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
            await service.chatStream(sourceId, message, trimHistory(readHistory(body)), (delta) => {
              res.write(`data: ${JSON.stringify({ delta })}\n\n`)
            })
            res.write('event: done\ndata: {}\n\n')
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`)
          } finally {
            res.end()
          }
        }, () => {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: ERRORS.bodyInvalidJson }))
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
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      const qty = typeof body.qty === 'number' && body.qty > 0 ? body.qty : 1
      const lines = service.cartAdd(sourceId, itemId, qty)
      return Promise.resolve({ ok: true, lines, total: service.cartTotal(sourceId) })
    }),

    postRoute(AD_API_PREFIX + '/cart/qty', (body) => {
      const itemId = requireString(body, 'itemId')
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      const qty = typeof body.qty === 'number' ? body.qty : 0
      const lines = service.cartSetQty(sourceId, itemId, qty)
      return Promise.resolve({ ok: true, lines, total: service.cartTotal(sourceId) })
    }),

    postRoute(AD_API_PREFIX + '/cart/remove', (body) => {
      const itemId = requireString(body, 'itemId')
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
      const lines = service.cartRemove(sourceId, itemId)
      return Promise.resolve({ ok: true, lines, total: service.cartTotal(sourceId) })
    }),

    postRoute(AD_API_PREFIX + '/cart/clear', (body) => {
      const sourceId = readSourceId(body, service.defaultSourceId())
      if (sourceId === undefined) return Promise.reject(new Error(ERRORS.noSourcesConfigured))
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
