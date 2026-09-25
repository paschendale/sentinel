import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildCtx, HttpRequestError } from './ctx.js'

// Real undici against a local server: these tests exercise the actual abort behaviour,
// which a mocked fetch cannot.

let server: Server
let base = ''
const openSockets = new Set<ServerResponse>()
let closedRequests = 0

function handler(req: IncomingMessage, res: ServerResponse): void {
  openSockets.add(res)
  res.on('close', () => {
    openSockets.delete(res)
    closedRequests += 1
  })
  if (req.url === '/stall-headers') return // never answers
  if (req.url === '/stall-body') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{"partial":') // headers + 11 bytes, then nothing
    return
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.write('olá ')
  res.end('mundo')
}

beforeAll(async () => {
  server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const res of openSockets) res.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('ctx.http timeouts', () => {
  it('reads a chunked body completely', async () => {
    const { ctx } = buildCtx({ testTimeoutMs: 5_000 })
    const res = await ctx.http.get(`${base}/ok`)
    expect(res.status).toBe(200)
    expect(res.body).toBe('olá mundo')
  })

  it('enforces options.timeout while waiting for headers', async () => {
    const { ctx } = buildCtx({ testTimeoutMs: 10_000 })
    const startMs = Date.now()
    const err = await ctx.http.get(`${base}/stall-headers`, { timeout: 300 }).catch((e: unknown) => e)
    expect(Date.now() - startMs).toBeLessThan(2_000)
    expect(err).toBeInstanceOf(HttpRequestError)
    expect(err).toMatchObject({ code: 'HTTP_TIMEOUT_ERROR' })
    expect((err as Error).message).toContain('after 300ms (no response headers received)')
  })

  it('enforces options.timeout while the body is still downloading, and reports progress', async () => {
    const { ctx } = buildCtx({ testTimeoutMs: 10_000 })
    const startMs = Date.now()
    const err = await ctx.http.get(`${base}/stall-body`, { timeout: 300 }).catch((e: unknown) => e)
    expect(Date.now() - startMs).toBeLessThan(2_000)
    expect(err).toMatchObject({ code: 'HTTP_TIMEOUT_ERROR' })
    expect((err as Error).message).toContain('headers received, 11 B of body read')
  })

  it('defaults the per-request limit to what is left of the test budget', async () => {
    const { ctx } = buildCtx({ testTimeoutMs: 400 })
    const startMs = Date.now()
    const err = await ctx.http.get(`${base}/stall-body`).catch((e: unknown) => e)
    expect(Date.now() - startMs).toBeLessThan(2_000)
    expect(err).toMatchObject({ code: 'HTTP_TIMEOUT_ERROR' })
  })

  it('rejects a non-positive timeout before sending anything', async () => {
    const { ctx } = buildCtx({ testTimeoutMs: 5_000 })
    await expect(ctx.http.get(`${base}/ok`, { timeout: 0 })).rejects.toThrow(TypeError)
  })

  it('lists pending calls and cancels them when the run signal aborts', async () => {
    const runAbort = new AbortController()
    const ioErrors: string[] = []
    const { ctx, getInFlight } = buildCtx({
      testTimeoutMs: 10_000,
      signal: runAbort.signal,
      onIoError: (info) => ioErrors.push(info.code),
    })
    const closedBefore = closedRequests
    const pending = ctx.http.get(`${base}/stall-body`).catch((e: unknown) => e)

    await new Promise((resolve) => setTimeout(resolve, 150))
    const inFlight = getInFlight()
    expect(inFlight).toHaveLength(1)
    expect(inFlight[0]).toMatch(/^GET http:\/\/127\.0\.0\.1:\d+\/stall-body \(\d+\.\ds, headers received, 11 B of body read\)$/)

    runAbort.abort(new Error('test run timed out after 10000ms'))
    const err = await pending
    expect(err).toMatchObject({ code: 'HTTP_FETCH_ERROR' })
    expect((err as Error).message).toContain('test run timed out after 10000ms')
    expect(getInFlight()).toEqual([])
    expect(ioErrors).toEqual(['HTTP_FETCH_ERROR'])

    // The server sees the connection closed: the request does not outlive the run.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(closedRequests).toBeGreaterThan(closedBefore)
  })

  it('fails immediately for calls made after the run was aborted', async () => {
    const runAbort = new AbortController()
    runAbort.abort(new Error('test run timed out after 1000ms'))
    const { ctx } = buildCtx({ testTimeoutMs: 1_000, signal: runAbort.signal })
    const startMs = Date.now()
    await expect(ctx.http.get(`${base}/ok`)).rejects.toMatchObject({ code: 'HTTP_FETCH_ERROR' })
    expect(Date.now() - startMs).toBeLessThan(500)
  })
})
