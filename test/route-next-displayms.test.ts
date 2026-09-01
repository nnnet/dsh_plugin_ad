/**
 * Unit tests for the new `displayMs` field in the `/api/ad/next`
 * response. The server returns the source's `displayMs` (or the
 * 15 000 ms default) alongside the next item so the browser
 * doesn't have to re-derive it from the source config on every
 * rotation tick.
 *
 * We invoke the route handler through a tiny in-process HTTP
 * harness: a `Readable` body for the request, a `PassThrough` for
 * the response, and `JSON.parse` on the captured buffer. This
 * exercises the same code path the host webserver does (incl.
 * `readJsonBody`), without booting a real listener.
 */

import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { makeAdRoutes } from '../src/routes.ts'
import type { AdService } from '../src/service.ts'

interface NextResponse {
  ok: true
  item: { id: string; type: string; clickUrl: string; displayMs?: number } | null
}

/** Build a Node `IncomingMessage`-shaped stream from a JSON body
 *  and run the route's handler against a capture stream. Returns
 *  the parsed JSON response. */
async function callNext(service: AdService, body: Record<string, unknown>): Promise<NextResponse> {
  const routes = makeAdRoutes({ service, ctx: {} as never })
  const next = routes.find(r => r.kind === 'exact' && r.path.endsWith('/next'))
  if (next === undefined) throw new Error('/next route not registered')

  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as import('node:http').IncomingMessage
  Object.defineProperty(req, 'method', { value: 'POST', configurable: true })
  // ServerResponse-shaped capture (the route only calls writeHead + end).
  const captured: { status: number; body: string } = { status: 0, body: '' }
  const res = {
    writeHead(status: number) { captured.status = status; return this },
    setHeader() { return this },
    getHeader() { return undefined },
    removeHeader() { return this },
    end(chunk?: unknown) {
      if (chunk !== undefined && chunk !== null) {
        captured.body += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      }
      return this
    },
    write() { return true },
    on() { return this },
    once() { return this },
    emit() { return true },
  } as unknown as import('node:http').ServerResponse

  await (next.handler as unknown as (req: unknown, res: unknown) => Promise<void>)(req, res)
  return JSON.parse(captured.body) as NextResponse
}

function makeStubService(overrides: Partial<AdService> = {}): AdService {
  return {
    nextItem: vi.fn(() => ({ id: 'a1', type: 'image' } as never)),
    resolveClickThrough: vi.fn(() => 'https://example.com/click'),
    getSource: vi.fn(() => ({ id: 'a', name: 'A', contentTypes: ['image'] } as never)),
    defaultSourceId: vi.fn(() => 'a'),
    ...overrides,
  } as unknown as AdService
}

describe('route /api/ad/next: displayMs wire shape', () => {
  it('returns the source displayMs on the item when set', async () => {
    const service = makeStubService({
      getSource: vi.fn(() => ({ id: 'a', name: 'A', contentTypes: ['image'], displayMs: 5_000 } as never)),
    })
    const json = await callNext(service, { sourceId: 'a' })
    expect(json.ok).toBe(true)
    expect(json.item?.displayMs).toBe(5_000)
  })

  it('falls back to the documented default (15 000) when the source omits displayMs', async () => {
    const service = makeStubService({
      getSource: vi.fn(() => ({ id: 'a', name: 'A', contentTypes: ['image'] } as never)),
    })
    const json = await callNext(service, { sourceId: 'a' })
    expect(json.item?.displayMs).toBe(15_000)
  })

  it('sends the source default for video items too (the server has no <video> element)', async () => {
    const service = makeStubService({
      nextItem: vi.fn(() => ({ id: 'v1', type: 'video' } as never)),
      getSource: vi.fn(() => ({ id: 'a', name: 'A', contentTypes: ['video'], displayMs: 8_000 } as never)),
    })
    const json = await callNext(service, { sourceId: 'a' })
    expect(json.item?.displayMs).toBe(8_000)
    // The server is NOT allowed to inject a video-duration-derived
    // value here — that refinement happens in the browser on
    // `loadedmetadata`. 8 000 ms is the source default, not a clip
    // duration.
    expect(json.item?.displayMs).not.toBeLessThan(8_000)
  })

  it('returns no item (and no displayMs) when the source has no items', async () => {
    const service = makeStubService({
      nextItem: vi.fn(() => undefined),
    })
    const json = await callNext(service, { sourceId: 'a' })
    expect(json.item).toBeNull()
  })

  it('legacy clients ignoring displayMs still receive the item shape unchanged', async () => {
    const service = makeStubService({
      getSource: vi.fn(() => ({ id: 'a', name: 'A', contentTypes: ['image'], displayMs: 7_000 } as never)),
    })
    const json = await callNext(service, { sourceId: 'a' })
    expect(json.item).toBeTruthy()
    expect(json.item?.id).toBe('a1')
    expect(json.item?.clickUrl).toBe('https://example.com/click')
    // The new field is additive on the item; the pre-existing keys
    // are still there. A client built before this change reads
    // `id`, `type`, `clickUrl` exactly as before.
    expect(Object.keys(json.item ?? {}).sort()).toEqual(['clickUrl', 'displayMs', 'id', 'type'])
  })
})
