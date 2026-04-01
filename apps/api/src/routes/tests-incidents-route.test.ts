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

describe('GET /tests/:id/incidents', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('queries newest runs window and computes threshold-aware incidents', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'test-1' }] } as never)
      .mockResolvedValueOnce({ rows: [{ failure_threshold: 3 }] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            started_at: new Date('2026-04-01T12:00:00.000Z'),
            finished_at: new Date('2026-04-01T12:00:01.000Z'),
            status: 'fail',
          },
          {
            started_at: new Date('2026-04-01T12:01:00.000Z'),
            finished_at: new Date('2026-04-01T12:01:01.000Z'),
            status: 'timeout',
          },
          {
            started_at: new Date('2026-04-01T12:02:00.000Z'),
            finished_at: new Date('2026-04-01T12:02:01.000Z'),
            status: 'fail',
          },
          {
            started_at: new Date('2026-04-01T12:03:00.000Z'),
            finished_at: new Date('2026-04-01T12:03:01.000Z'),
            status: 'success',
          },
        ],
      } as never)

    const app = await buildServer()
    const res = await app.inject({
      method: 'GET',
      url: '/tests/test-1/incidents',
      headers: { authorization: 'Bearer test-token' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      {
        started_at: '2026-04-01T12:00:00.000Z',
        ended_at: '2026-04-01T12:03:01.000Z',
        duration_ms: 181000,
        failure_count: 3,
        ongoing: false,
      },
    ])

    const runsCall = mockQuery.mock.calls[2]
    expect(runsCall).toBeDefined()
    const sql = String(runsCall?.[0])
    expect(sql).toContain('ORDER BY finished_at DESC')
    expect(sql).toContain('LIMIT 500')
    expect(sql).toContain('ORDER BY finished_at ASC')
  })
})
