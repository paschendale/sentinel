import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

import { buildServer } from '../server.js'
import { verifyJwt } from '../auth/jwt.js'

describe('POST /auth/mcp-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function login(app: Awaited<ReturnType<typeof buildServer>>): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })
    return (JSON.parse(res.body) as { token: string }).token
  }

  it('requires authentication', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'POST', url: '/auth/mcp-token', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('issues a valid token with the default 1-year expiry', async () => {
    const app = await buildServer()
    const session = await login(app)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mcp-token',
      headers: { authorization: `Bearer ${session}` },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { token: string; expires_at: string }
    const claims = verifyJwt(body.token)
    expect(claims?.['sub']).toBe('mcp')
    const expiresMs = new Date(body.expires_at).getTime() - Date.now()
    expect(expiresMs).toBeGreaterThan(8759 * 3_600_000)
    expect(expiresMs).toBeLessThanOrEqual(8760 * 3_600_000)
  })

  it('accepts a custom expiry', async () => {
    const app = await buildServer()
    const session = await login(app)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mcp-token',
      headers: { authorization: `Bearer ${session}` },
      payload: { expires_in_hours: 720 },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { expires_at: string }
    const expiresMs = new Date(body.expires_at).getTime() - Date.now()
    expect(expiresMs).toBeLessThanOrEqual(720 * 3_600_000)
    expect(expiresMs).toBeGreaterThan(719 * 3_600_000)
  })

  it.each([0, -5, 87_601, 1.5, 'a year'])('rejects invalid expires_in_hours %p', async (bad) => {
    const app = await buildServer()
    const session = await login(app)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mcp-token',
      headers: { authorization: `Bearer ${session}` },
      payload: { expires_in_hours: bad },
    })
    expect(res.statusCode).toBe(400)
  })
})
