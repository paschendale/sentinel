import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCtx, HttpRequestError } from './ctx.js'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

vi.mock('undici', () => ({
  fetch: fetchMock,
}))

describe('executor ctx http', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('passes redirect mode to undici fetch', async () => {
    const mockResponse = {
      status: 302,
      text: vi.fn().mockResolvedValue(''),
      headers: {
        forEach: vi.fn(),
      },
    }
    fetchMock.mockResolvedValue(mockResponse)

    const { ctx } = buildCtx()
    await ctx.http.get('https://example.com', { redirect: 'manual' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'GET', redirect: 'manual' })
    )
  })

  it('throws explicit redirect error when redirect limit is exceeded', async () => {
    const redirectCause = new Error('redirect count exceeded')
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: redirectCause }))

    const { ctx } = buildCtx()

    await expect(ctx.http.get('https://example.com')).rejects.toMatchObject({
      name: 'HttpRequestError',
      code: 'HTTP_REDIRECT_ERROR',
      url: 'https://example.com',
      method: 'GET',
    })
  })

  it('throws generic fetch error for non-redirect failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))

    const { ctx } = buildCtx()

    try {
      await ctx.http.get('https://example.com')
      throw new Error('expected request to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpRequestError)
      expect(err).toMatchObject({
        code: 'HTTP_FETCH_ERROR',
      })
    }
  })
})
