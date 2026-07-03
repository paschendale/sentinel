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
