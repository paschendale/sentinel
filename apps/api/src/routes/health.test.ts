import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

import { pool } from '../db/pool.js'
import { buildServer } from '../server.js'

const mockQuery = vi.mocked(pool.query)

describe('health route', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('returns 200 when the database is reachable, without auth', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const app = await buildServer()

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' })
  })

  it('returns 503 when the database is unreachable', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'))
    const app = await buildServer()

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body)).toEqual({ status: 'error', error: 'connection refused' })
  })
})
