import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return {
    ...actual,
    RAW_RETENTION_DAYS: 7,
    AGG_RETENTION_DAYS: 90,
    PRUNE_BATCH_SIZE: 2,
  }
})

vi.mock('./pool.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

import { pool } from './pool.js'
import { runAggregation, startAggregator, stopAggregator } from './aggregator.js'

const mockQuery = vi.mocked(pool.query)

beforeEach(() => {
  mockQuery.mockClear()
  mockQuery.mockResolvedValue({ rows: [] } as never)
})

afterEach(() => {
  stopAggregator()
  vi.restoreAllMocks()
})

describe('runAggregation', () => {
  it('issues the uptime_daily upsert with yesterday and tomorrow dates (covers yesterday + today)', async () => {
    await runAggregation()

    const firstCall = mockQuery.mock.calls[0]
    expect(firstCall).toBeDefined()
    const sql = firstCall![0] as string
    expect(sql).toContain('INSERT INTO uptime_daily')
    expect(sql).toContain('ON CONFLICT (test_id, date) DO UPDATE')
    const params = firstCall![1] as string[]
    expect(params).toHaveLength(2)
    // both should be ISO date strings (YYYY-MM-DD)
    expect(params[0]!).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(params[1]!).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // yesterday < tomorrow (range covers yesterday and today)
    expect(params[0]! < params[1]!).toBe(true)
    // gap should be 2 days
    const diff = new Date(params[1]!).getTime() - new Date(params[0]!).getTime()
    expect(diff).toBe(2 * 24 * 60 * 60 * 1000)
  })

  it('prunes test_runs in batches and stops when batch is smaller than limit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never) // upsert
      .mockResolvedValueOnce({ rowCount: 2, rows: [] } as never) // prune batch 1
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as never) // prune batch 2
      .mockResolvedValue({ rows: [], rowCount: 0 } as never) // rest

    await runAggregation()

    const pruneCalls = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM test_runs'),
    )
    expect(pruneCalls).toHaveLength(2)
  })

  it('issues the uptime_daily DELETE using retention parameter', async () => {
    await runAggregation()

    const deleteCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM uptime_daily'),
    )
    expect(deleteCall).toBeDefined()
    expect(deleteCall![0]).toContain('CURRENT_DATE - $1::int')
    expect(deleteCall![1]).toEqual([90])
  })

  it('makes expected maintenance calls in order', async () => {
    await runAggregation()
    // upsert + prune + create partition x3 + prune uptime_daily
    expect(mockQuery).toHaveBeenCalledTimes(6)
  })
})

describe('maintenance resilience', () => {
  it('continues to prune uptime_daily even if raw pruning throws', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never) // upsert
      .mockRejectedValueOnce(new Error('raw prune failed'))
      .mockResolvedValue({ rows: [] } as never)

    await runAggregation()

    const deleteCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM uptime_daily'),
    )
    expect(deleteCall).toBeDefined()
  })

  it('creates monthly partitions for current month plus next two months', async () => {
    await runAggregation()

    const createPartitionCalls = mockQuery.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('CREATE TABLE IF NOT EXISTS test_runs_'),
    )
    expect(createPartitionCalls).toHaveLength(3)
  })
})

describe('startAggregator / stopAggregator', () => {
  it('stopAggregator is safe to call when not started', () => {
    expect(() => stopAggregator()).not.toThrow()
  })

  it('startAggregator runs aggregation immediately and again at midnight UTC', async () => {
    vi.useFakeTimers()
    startAggregator()

    // Immediate run fires as fire-and-forget; flush pending promises
    await vi.advanceTimersByTimeAsync(0)
    const callsAfterStart = mockQuery.mock.calls.length
    expect(callsAfterStart).toBeGreaterThan(0)

    mockQuery.mockClear()

    // Advance to just past the next midnight UTC
    const now = new Date()
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    const msToMidnight = midnight.getTime() - now.getTime()

    await vi.advanceTimersByTimeAsync(msToMidnight + 1)

    // midnight run fires: expect at least the upsert query to have been called
    expect(mockQuery).toHaveBeenCalled()

    stopAggregator()
    vi.useRealTimers()
  })

  it('stopAggregator prevents the midnight job from running (startup run already fired)', async () => {
    vi.useFakeTimers()
    startAggregator()
    await vi.advanceTimersByTimeAsync(0)
    mockQuery.mockClear()

    stopAggregator()

    // Advance well past midnight — no more queries after stop
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000)

    expect(mockQuery).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
