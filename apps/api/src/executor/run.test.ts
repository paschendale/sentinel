import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runTest } from './run.js'

let server: Server
let base = ''
const openSockets = new Set<ServerResponse>()
let hits = 0
let closedStalls = 0
let failFirst = 0

function handler(req: IncomingMessage, res: ServerResponse): void {
  hits += 1
  openSockets.add(res)
  res.on('close', () => openSockets.delete(res))
  if (req.url === '/stall-body') {
    res.on('close', () => {
      closedStalls += 1
    })
    res.writeHead(200)
    res.write('x')
    return
  }
  if (req.url === '/flaky' && failFirst > 0) {
    failFirst -= 1
    res.writeHead(500)
    res.end('boom')
    return
  }
  if (req.url === '/down') {
    res.writeHead(503)
    res.end('down')
    return
  }
  res.writeHead(200)
  res.end('ok')
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

beforeEach(() => {
  hits = 0
  failFirst = 0
})

function statusCheck(path: string): string {
  return `const r = await ctx.http.get('${base}${path}'); ctx.assert('status 200', r.status === 200); return true`
}

describe('runTest timeout', () => {
  it('names the in-flight call in error_message and closes its connection', async () => {
    const closedBefore = closedStalls
    const result = await runTest(
      { id: 'run-timeout-inflight', code: `await ctx.http.get('${base}/stall-body'); return true`, timeout_ms: 400 },
      { trigger: 'api-post' }
    )
    expect(result.status).toBe('timeout')
    expect(result.error_message).toMatch(
      /^Timed out after 400ms; in flight: GET http:\/\/127\.0\.0\.1:\d+\/stall-body \(\d+\.\ds, headers received, 1 B of body read\)$/
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(closedStalls).toBeGreaterThan(closedBefore)
  })

  it('keeps the plain message when nothing is in flight', async () => {
    const result = await runTest(
      { id: 'run-timeout-cpu', code: 'await new Promise((r) => setTimeout(r, 2000)); return true', timeout_ms: 200 },
      { trigger: 'api-post' }
    )
    expect(result.status).toBe('timeout')
    expect(result.error_message).toBe('Timed out after 200ms')
  })
})
