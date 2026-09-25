import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runTest, runTestWithRetries } from './run.js'

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

  it('records timeout, not fail, when a request without its own timeout hits the run deadline', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await runTest(
        { id: `run-deadline-${i}`, code: `await ctx.http.get('${base}/stall-body'); return true`, timeout_ms: 150 },
        { trigger: 'api-post' }
      )
      expect(result.status).toBe('timeout')
    }
  })

  it('records fail with HTTP_TIMEOUT_ERROR when the request timeout is below the run deadline', async () => {
    const result = await runTest(
      {
        id: 'run-request-timeout',
        code: `await ctx.http.get('${base}/stall-body', { timeout: 100 }); return true`,
        timeout_ms: 2_000,
      },
      { trigger: 'api-post' }
    )
    expect(result.status).toBe('fail')
    expect(result.error_message).toMatch(/^HTTP request timed out for GET .*\/stall-body after 100ms \(headers received, 1 B of body read\)$/)
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

describe('runTestWithRetries', () => {
  const timing = { timeout_ms: 1_000, schedule_ms: 30_000 }

  it('records a pass when a retry succeeds', async () => {
    failFirst = 1
    const result = await runTestWithRetries(
      { ...timing, id: 'retry-recovers', code: statusCheck('/flaky'), retries: 1 },
      { trigger: 'scheduler' }
    )
    expect(result.status).toBe('success')
    expect(result.error_message).toBeNull()
    expect(hits).toBe(2)
  })

  it('records the last failure, marked with the attempt count, when every attempt fails', async () => {
    const result = await runTestWithRetries(
      { ...timing, id: 'retry-exhausted', code: statusCheck('/down'), retries: 2 },
      { trigger: 'scheduler' }
    )
    expect(result.status).toBe('fail')
    expect(result.error_message).toBe('Assertion "status 200" failed [all 3 attempts failed]')
    expect(hits).toBe(3)
  })

  it('makes a single attempt when retries is 0', async () => {
    const result = await runTestWithRetries(
      { ...timing, id: 'retry-none', code: statusCheck('/down'), retries: 0 },
      { trigger: 'scheduler' }
    )
    expect(result.status).toBe('fail')
    expect(result.error_message).toBe('Assertion "status 200" failed')
    expect(hits).toBe(1)
  })

  it('skips a retry that would not finish within 80% of schedule_ms', async () => {
    // 1000ms attempt, 80% of 1200ms = 960ms: even a second attempt alone would not fit.
    const result = await runTestWithRetries(
      { id: 'retry-no-room', code: statusCheck('/down'), timeout_ms: 1_000, schedule_ms: 1_200, retries: 3 },
      { trigger: 'scheduler' }
    )
    expect(result.status).toBe('fail')
    expect(hits).toBe(1)
  })

  it('does not retry a passing test', async () => {
    const result = await runTestWithRetries(
      { ...timing, id: 'retry-pass', code: statusCheck('/ok'), retries: 3 },
      { trigger: 'scheduler' }
    )
    expect(result.status).toBe('success')
    expect(hits).toBe(1)
  })
})
