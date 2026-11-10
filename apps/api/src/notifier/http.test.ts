import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('undici', () => ({ request: vi.fn() }))

import { request } from 'undici'
import { NOTIFY_TIMEOUT_MS, notifyRequest } from './http.js'
import { TransportError } from './transports/types.js'

const mockRequest = vi.mocked(request)

function streamBody(chunks: string[]) {
  const destroy = vi.fn()
  return {
    destroy,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield Buffer.from(c)
    },
  }
}

describe('notifyRequest', () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  it('sends JSON with a timeout and reads the response body', async () => {
    mockRequest.mockResolvedValue({ statusCode: 204, body: streamBody(['ok']) } as never)
    const res = await notifyRequest('https://hooks.example.com/x', { method: 'POST', body: { a: 1 } })
    expect(res).toEqual({ statusCode: 204, text: 'ok' })
    const [, init] = mockRequest.mock.calls[0]!
    expect(init).toMatchObject({ method: 'POST', body: '{"a":1}', headersTimeout: NOTIFY_TIMEOUT_MS, bodyTimeout: NOTIFY_TIMEOUT_MS })
    expect((init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal)
    expect((init as { headers: Record<string, string> }).headers['content-type']).toBe('application/json')
  })

  it('stops reading a large body and releases the socket', async () => {
    const body = streamBody(['x'.repeat(40 * 1024), 'y'.repeat(40 * 1024), 'z'.repeat(40 * 1024)])
    mockRequest.mockResolvedValue({ statusCode: 200, body } as never)
    const res = await notifyRequest('https://hooks.example.com/x', { method: 'POST', body: {} })
    expect(res.text.length).toBe(64 * 1024)
    expect(body.destroy).toHaveBeenCalled()
  })

  it('returns non-2xx statuses instead of throwing', async () => {
    mockRequest.mockResolvedValue({ statusCode: 500, body: streamBody(['nope']) } as never)
    await expect(notifyRequest('https://hooks.example.com/x', { method: 'POST', body: {} })).resolves.toEqual({ statusCode: 500, text: 'nope' })
  })

  it('turns a timeout into a TransportError that names the host', async () => {
    mockRequest.mockImplementation(async () => {
      const e = new Error('The operation was aborted due to timeout')
      e.name = 'TimeoutError'
      throw e
    })
    const err = await notifyRequest('https://hooks.example.com/x', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TransportError)
    expect((err as Error).message).toBe(`request to hooks.example.com timed out after ${NOTIFY_TIMEOUT_MS} ms`)
  })
})
