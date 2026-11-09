import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../auth/jwt.js', () => ({
  verifyJwt: vi.fn(() => true),
}))

import { pool } from '../db/pool.js'
import { buildServer } from '../server.js'
import { parseSections, withSections } from './dashboard.js'

const mockQuery = vi.mocked(pool.query)
const auth = { authorization: 'Bearer test-token' }

const recent = new Date(Date.now() - 60 * 60 * 1000)

function row(over: Record<string, unknown>) {
  return {
    id: 'x', name: 'x', enabled: true, tags: [], failure_threshold: 3,
    last_status: 'success', last_run_at: new Date(), public_status: 'up', consecutive_failures: 0,
    problem_started_at: null, problem_ended_at: null, problem_worst: null, last_problem_at: null,
    pass_rate_7d: 100, avg_latency_ms: 10,
    ...over,
  }
}

const ROWS = [
  row({ id: 'clean', name: 'Clean' }),
  row({ id: 'off', name: 'Off', enabled: false }),
  row({ id: 'rec', name: 'Recovered', last_problem_at: recent, problem_started_at: recent, problem_ended_at: recent, problem_worst: 'down' }),
  row({ id: 'warn', name: 'Warn', public_status: 'degraded', last_status: 'warn', problem_started_at: recent, last_problem_at: recent }),
  row({ id: 'down', name: 'Down', public_status: 'down', last_status: 'fail', consecutive_failures: 4, problem_started_at: recent, last_problem_at: recent }),
]

describe('GET /dashboard', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('returns every test with its section, ordered by section, with ISO timestamps', async () => {
    mockQuery.mockResolvedValueOnce({ rows: ROWS } as never)
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/dashboard', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Array<{ id: string; section: string; problem_started_at: string | null; last_run_at: string }>
    expect(body.map((t) => [t.id, t.section])).toEqual([
      ['down', 'critical'], ['warn', 'warning'], ['rec', 'recovered'], ['clean', 'clean'], ['off', 'disabled'],
    ])
    expect(body[0]!.problem_started_at).toBe(recent.toISOString())
    expect(typeof body[0]!.last_run_at).toBe('string')
    expect(mockQuery.mock.calls[0]![1]).toEqual([null])
  })

  it('passes the tag filter to the query and filters by sections', async () => {
    mockQuery.mockResolvedValueOnce({ rows: ROWS } as never)
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/dashboard?tag=ui:x&section=critical,warning', headers: auth })
    expect(res.statusCode).toBe(200)
    expect((res.json() as Array<{ id: string }>).map((t) => t.id)).toEqual(['down', 'warn'])
    expect(mockQuery.mock.calls[0]![1]).toEqual(['ui:x'])
  })

  it('rejects an unknown section', async () => {
    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/dashboard?section=broken', headers: auth })
    expect(res.statusCode).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('parseSections and withSections', () => {
  it('parses an empty value as no filter and trims entries', () => {
    expect(parseSections(undefined)).toBeNull()
    expect(parseSections('')).toBeNull()
    expect(parseSections(' clean , recovered ')).toEqual(new Set(['clean', 'recovered']))
    expect(parseSections('clean,nope')).toBe('invalid')
  })

  it('orders inside a section with the shared rule', () => {
    const older = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
    const newer = new Date(Date.now() - 60 * 1000).toISOString()
    const out = withSections([
      { ...row({ id: 'a', name: 'A', public_status: 'down', problem_started_at: older }), last_run_at: null, problem_started_at: older },
      { ...row({ id: 'b', name: 'B', public_status: 'down', problem_started_at: newer }), last_run_at: null, problem_started_at: newer },
    ] as never)
    expect(out.map((t: { id: string }) => t.id)).toEqual(['b', 'a'])
  })
})
