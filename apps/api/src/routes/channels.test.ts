import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('undici', () => ({
  request: vi.fn(),
}))

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../auth/jwt.js', () => ({
  verifyJwt: vi.fn(() => true),
}))

import { request } from 'undici'
import { pool } from '../db/pool.js'
import { buildServer } from '../server.js'

const mockQuery = vi.mocked(pool.query)
const mockRequest = vi.mocked(request)
const auth = { authorization: 'Bearer test-token' }

const storedRow = {
  id: 'ch-1',
  name: 'ops',
  type: 'slack_bot',
  webhook_url: null,
  email_to: null,
  channel_ref: 'C123',
  enabled: true,
  has_bot_token: true,
}

describe('channels routes', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRequest.mockReset()
  })

  it('refuses a bot channel without a token or channel id', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'POST', url: '/channels', headers: auth, payload: { name: 'ops', type: 'slack_bot' } })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('bot_token required')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('stores the bot token as a cipher blob and never returns it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [storedRow] } as never)
    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/channels',
      headers: auth,
      payload: { name: 'ops', type: 'slack_bot', channel_ref: 'C123', bot_token: 'xoxb-secret' },
    })
    expect(res.statusCode).toBe(201)
    const insert = mockQuery.mock.calls[0]
    expect(insert?.[0]).toContain('INSERT INTO notification_channels')
    expect(insert?.[0]).not.toContain('SELECT *')
    const params = (insert?.[1] ?? []) as unknown[]
    const blob = params[6]
    expect(Buffer.isBuffer(blob)).toBe(true)
    expect((blob as Buffer).toString('utf8')).not.toBe('xoxb-secret') // version byte prefix, never the raw value
    expect(params).not.toContain('xoxb-secret')
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['bot_token']).toBeUndefined()
    expect(body['has_bot_token']).toBe(true)
  })

  it('refuses a PATCH that turns a webhook channel into a bot channel without a token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...storedRow, type: 'slack', webhook_url: 'https://hooks.example/x', channel_ref: null, has_bot_token: false }] } as never)
    const app = await buildServer()
    const res = await app.inject({ method: 'PATCH', url: '/channels/ch-1', headers: auth, payload: { type: 'slack_bot', channel_ref: 'C123' } })
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain('bot_token required')
  })

  it('keeps the stored token when a PATCH omits bot_token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [storedRow] } as never) // getChannel
      .mockResolvedValueOnce({ rows: [{ ...storedRow, name: 'ops-renamed' }] } as never) // UPDATE
    const app = await buildServer()
    const res = await app.inject({ method: 'PATCH', url: '/channels/ch-1', headers: auth, payload: { name: 'ops-renamed' } })
    expect(res.statusCode).toBe(200)
    const update = mockQuery.mock.calls[1]
    expect(update?.[0]).toContain('UPDATE notification_channels SET name = $2')
    expect(update?.[0]).not.toContain('bot_token_blob =')
  })

  it('POST /channels/:id/test sends a one-off message through a webhook channel', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'ch-2', type: 'webhook', webhook_url: 'https://example.com/hook', email_to: null, channel_ref: null, bot_token_blob: null }],
    } as never)
    mockRequest.mockResolvedValueOnce({ statusCode: 204 } as never)
    const app = await buildServer()
    const res = await app.inject({ method: 'POST', url: '/channels/ch-2/test', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, http_status: 204 })
    expect(mockRequest.mock.calls[0]?.[0]).toBe('https://example.com/hook')
    const body = JSON.parse((mockRequest.mock.calls[0]?.[1] as { body: string }).body) as Record<string, unknown>
    expect(body['event']).toBe('test')
  })

  it('POST /channels/:id/test reports a provider failure as 502', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'ch-2', type: 'discord', webhook_url: 'https://discord.com/api/webhooks/x', email_to: null, channel_ref: null, bot_token_blob: null }],
    } as never)
    mockRequest.mockResolvedValueOnce({ statusCode: 401 } as never)
    const app = await buildServer()
    const res = await app.inject({ method: 'POST', url: '/channels/ch-2/test', headers: auth })
    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, http_status: 401 })
  })
})
