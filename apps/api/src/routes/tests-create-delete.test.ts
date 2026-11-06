import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../auth/jwt.js', () => ({
  verifyJwt: vi.fn(() => true),
}))

import { pool } from '../db/pool.js'
import { buildServer } from '../server.js'

const mockQuery = vi.mocked(pool.query)
const auth = { authorization: 'Bearer test-token' }

describe('POST /tests persists alerting fields', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('writes failure_threshold and cooldown_ms on create', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't-1', enabled: false }] } as never)
    const app = await buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/tests',
      headers: auth,
      payload: { name: 'x', code: 'return true', schedule_ms: 60_000, timeout_ms: 5_000, enabled: false, failure_threshold: 1, cooldown_ms: 0 },
    })
    expect(res.statusCode).toBe(201)
    const insert = mockQuery.mock.calls[0]
    expect(insert?.[0]).toContain('failure_threshold, cooldown_ms')
    const params = (insert?.[1] ?? []) as unknown[]
    expect(params.slice(-2)).toEqual([1, 0])
  })
})

describe('DELETE /tests/:id', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('removes the channel assignments scoped to the deleted test', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 } as never) // DELETE FROM tests
      .mockResolvedValueOnce({ rowCount: 2 } as never) // DELETE FROM channel_assignments
    const app = await buildServer()
    const res = await app.inject({ method: 'DELETE', url: '/tests/t-1', headers: auth })
    expect(res.statusCode).toBe(204)
    const cleanup = mockQuery.mock.calls[1]
    expect(cleanup?.[0]).toContain("DELETE FROM channel_assignments WHERE scope_type = 'test'")
    expect(cleanup?.[1]).toEqual(['t-1'])
  })
})
