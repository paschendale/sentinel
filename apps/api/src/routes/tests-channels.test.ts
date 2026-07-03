import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../auth/jwt.js', () => ({
  verifyJwt: vi.fn(() => true),
}))

import { pool } from '../db/pool.js'
import { buildServer } from '../server.js'

const mockQuery = vi.mocked(pool.query)

describe('POST /tests/:id/channels', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('defaults event_types to all three when omitted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'test-1' }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'channel-1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/tests/test-1/channels',
      headers: { authorization: 'Bearer test-token' },
      payload: { channel_id: 'channel-1' },
    })

    expect(res.statusCode).toBe(201)
    const insertCall = mockQuery.mock.calls[2]
    expect(insertCall?.[0]).toContain('INSERT INTO channel_assignments')
    expect(insertCall?.[1]).toEqual(['channel-1', 'test', 'test-1', ['fail', 'warning', 'recovery']])
  })

  it('passes through an explicit event_types subset', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'test-1' }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'channel-1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/tests/test-1/channels',
      headers: { authorization: 'Bearer test-token' },
      payload: { channel_id: 'channel-1', event_types: ['fail'] },
    })

    expect(res.statusCode).toBe(201)
    const insertCall = mockQuery.mock.calls[2]
    expect(insertCall?.[1]).toEqual(['channel-1', 'test', 'test-1', ['fail']])
  })

  it('rejects an empty event_types array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'test-1' }] } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/tests/test-1/channels',
      headers: { authorization: 'Bearer test-token' },
      payload: { channel_id: 'channel-1', event_types: [] },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('GET /tests/:id/channels/effective', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('404s for a missing test', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'GET',
      url: '/tests/missing/channels/effective',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns the merged direct + tag-inherited channel list', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'test-1' }] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'channel-1', name: 'ops', type: 'webhook', webhook_url: 'https://example.com', email_to: null, enabled: true,
            scope_type: 'tag', scope_value: 'prod', event_types: ['warning'],
          },
        ],
      } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'GET',
      url: '/tests/test-1/channels/effective',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{ id: string; event_types: string[]; sources: unknown[] }>
    expect(body).toHaveLength(1)
    expect(body[0]?.event_types).toEqual(['warning'])
    expect(body[0]?.sources).toEqual([{ scope_type: 'tag', scope_value: 'prod', event_types: ['warning'] }])
  })
})
