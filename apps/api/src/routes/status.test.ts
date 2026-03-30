import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pool before importing the module under test
vi.mock('../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

import { pool } from '../db/pool.js'
import { buildServer } from '../server.js'

const mockQuery = vi.mocked(pool.query)

/** Returns a YYYY-MM-DD string for today minus `daysAgo` UTC days. */
function utcDayAgo(daysAgo: number): string {
  const now = new Date()
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function makeTestRow(overrides: Partial<{ id: string; name: string; enabled: boolean; tags: string[] }> = {}) {
  return {
    id: overrides.id ?? 'test-1',
    name: overrides.name ?? 'My Test',
    enabled: overrides.enabled ?? true,
    tags: overrides.tags ?? [],
  }
}

function makeUdRow(overrides: Partial<{
  test_id: string
  date: string
  success_count: number
  failure_count: number
}> = {}) {
  return {
    test_id: overrides.test_id ?? 'test-1',
    date: overrides.date ?? utcDayAgo(1),
    success_count: overrides.success_count ?? 1,
    failure_count: overrides.failure_count ?? 0,
  }
}

function makeStateRow(overrides: Partial<{ test_id: string; public_status: string }> = {}) {
  return {
    test_id: overrides.test_id ?? 'test-1',
    public_status: overrides.public_status ?? 'up',
  }
}

describe('GET /status', () => {
  beforeEach(() => {
    mockQuery.mockClear()
  })

  it('returns 200 with an array', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow()] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toBeInstanceOf(Array)
  })

  it('returns empty array when no tests exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('computes current_status as up when state is up', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1' })] } as never)
      .mockResolvedValueOnce({
        rows: [makeUdRow({ test_id: 't1', date: utcDayAgo(1), success_count: 5, failure_count: 0 })],
      } as never)
      .mockResolvedValueOnce({ rows: [makeStateRow({ test_id: 't1', public_status: 'up' })] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ current_status: string }>
    expect(body[0]!.current_status).toBe('up')
  })

  it('computes current_status as down when state is down', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1' })] } as never)
      .mockResolvedValueOnce({
        rows: [makeUdRow({ test_id: 't1', date: utcDayAgo(1), success_count: 0, failure_count: 3 })],
      } as never)
      .mockResolvedValueOnce({ rows: [makeStateRow({ test_id: 't1', public_status: 'down' })] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ current_status: string }>
    expect(body[0]!.current_status).toBe('down')
  })

  it('computes current_status as degraded when state is degraded', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1' })] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [makeStateRow({ test_id: 't1', public_status: 'degraded' })] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ current_status: string }>
    expect(body[0]!.current_status).toBe('degraded')
  })

  it('returns current_status unknown when no state row exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1' })] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ current_status: string; uptime_pct_30d: null }>
    expect(body[0]!.current_status).toBe('unknown')
    expect(body[0]!.uptime_pct_30d).toBeNull()
  })

  it('computes uptime_pct_30d correctly', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1' })] } as never)
      .mockResolvedValueOnce({
        rows: [
          makeUdRow({ test_id: 't1', date: utcDayAgo(5), success_count: 3, failure_count: 1 }),
          makeUdRow({ test_id: 't1', date: utcDayAgo(4), success_count: 6, failure_count: 0 }),
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ uptime_pct_30d: number }>
    // 9 successes / (9 + 1) total = 90%
    expect(body[0]!.uptime_pct_30d).toBe(90)
  })

  it('returns exactly 30 days entries per test', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1' })] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ days: unknown[] }>
    expect(body[0]!.days).toHaveLength(30)
  })

  it('marks a mixed day as degraded', async () => {
    const targetDate = utcDayAgo(5)
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1' })] } as never)
      .mockResolvedValueOnce({
        rows: [makeUdRow({ test_id: 't1', date: targetDate, success_count: 5, failure_count: 1 })],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ days: Array<{ date: string; outcome: string }> }>
    const day = body[0]!.days.find(d => d.date === targetDate)
    expect(day?.outcome).toBe('degraded')
  })

  it('marks an all-failure day as down', async () => {
    const targetDate = utcDayAgo(5)
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1' })] } as never)
      .mockResolvedValueOnce({
        rows: [makeUdRow({ test_id: 't1', date: targetDate, success_count: 0, failure_count: 3 })],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ days: Array<{ date: string; outcome: string }> }>
    const day = body[0]!.days.find(d => d.date === targetDate)
    expect(day?.outcome).toBe('down')
  })

  it('includes disabled tests with enabled: false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeTestRow({ id: 't1', enabled: false })] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)

    const app = await buildServer()
    const res = await app.inject({ method: 'GET', url: '/status' })
    const body = JSON.parse(res.body) as Array<{ enabled: boolean }>
    expect(body[0]!.enabled).toBe(false)
  })
})
