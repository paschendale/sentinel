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

describe('tags routes', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('rejects empty normalized tag param', async () => {
    const app = await buildServer()
    const res = await app.inject({
      method: 'GET',
      url: '/tags/%20/channels',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid tag' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('normalizes tag before persisting assignment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'channel-1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/tags/%20PrOd%20/channels',
      headers: { authorization: 'Bearer test-token' },
      payload: { channel_id: 'channel-1' },
    })

    expect(res.statusCode).toBe(201)
    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall?.[0]).toContain('INSERT INTO channel_assignments')
    expect(insertCall?.[1]).toEqual(['channel-1', 'tag', 'prod', ['fail', 'warning', 'recovery']])
  })

  it('defaults event_types to all three when omitted, and passes through explicit subset', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'channel-1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/tags/prod/channels',
      headers: { authorization: 'Bearer test-token' },
      payload: { channel_id: 'channel-1', event_types: ['warning'] },
    })

    expect(res.statusCode).toBe(201)
    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall?.[1]).toEqual(['channel-1', 'tag', 'prod', ['warning']])
  })
})
