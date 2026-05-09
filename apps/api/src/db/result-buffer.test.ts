import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the pool before importing the module under test
vi.mock('./pool.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}))

import { pool } from './pool.js'
import { enqueue, flush, startFlusher, stopFlusher } from './result-buffer.js'

const mockQuery = vi.mocked(pool.query)

function makeResult(overrides: Partial<{
  id: string
  test_id: string
  started_at: Date
  finished_at: Date
  status: 'success' | 'fail' | 'timeout'
  duration_ms: number
  error_message: string | null
  assertions: Array<{ id: string; name: string; passed: boolean; message: string | null }>
}> = {}) {
  return {
    id: overrides.id ?? 'run-1',
    test_id: overrides.test_id ?? 'test-1',
    started_at: overrides.started_at ?? new Date('2026-01-01T00:00:00Z'),
    finished_at: overrides.finished_at ?? new Date('2026-01-01T00:00:01Z'),
    status: overrides.status ?? 'success' as const,
    duration_ms: overrides.duration_ms ?? 100,
    error_message: overrides.error_message ?? null,
    assertions: overrides.assertions ?? [],
  }
}

beforeEach(() => {
  mockQuery.mockClear()
  mockQuery.mockResolvedValue({ rows: [] } as never)
})

afterEach(() => {
  stopFlusher()
  // Flush any leftover buffer state between tests
  vi.restoreAllMocks()
})

describe('flush', () => {
  it('is a no-op when buffer is empty', async () => {
    await flush()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('calls pool.query three times (test_runs, prev-state select, test_state upsert) for one result', async () => {
    enqueue(makeResult())
    await flush()
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })

  it('inserts all buffered rows in a single test_runs query', async () => {
    enqueue(makeResult({ id: 'r1', test_id: 'test-1' }))
    enqueue(makeResult({ id: 'r2', test_id: 'test-2' }))
    enqueue(makeResult({ id: 'r3', test_id: 'test-3' }))
    await flush()

    const testRunsCall = mockQuery.mock.calls[0]
    expect(testRunsCall).toBeDefined()
    const sql = testRunsCall![0] as string
    expect(sql).toContain('INSERT INTO test_runs')
    // 3 rows × 7 params = 21 params
    const params = testRunsCall![1] as unknown[]
    expect(params).toHaveLength(21)
  })

  it('drains the buffer: a second flush with no new enqueues is a no-op', async () => {
    enqueue(makeResult())
    await flush()
    mockQuery.mockClear()
    await flush()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('re-queues rows on pool.query error and re-throws', async () => {
    const error = new Error('DB down')
    mockQuery.mockRejectedValueOnce(error)

    enqueue(makeResult({ id: 'r1' }))
    await expect(flush()).rejects.toThrow('DB down')

    // Rows should be back in the buffer — next flush should call query again
    mockQuery.mockClear()
    mockQuery.mockResolvedValue({ rows: [] } as never)
    await flush()
    // test_runs + prev-state select + test_state upsert = 3 queries for the re-queued row
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })

  it('skips assertion_results insert when result has no assertions', async () => {
    enqueue(makeResult())
    await flush()
    const assertionCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO assertion_results'),
    )
    expect(assertionCall).toBeUndefined()
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })

  it('inserts assertion_results after test_runs when assertions are present', async () => {
    enqueue(makeResult({
      assertions: [
        { id: 'a-1', name: 'status is 200', passed: true, message: null },
        { id: 'a-2', name: 'body matches', passed: false, message: 'expected foo' },
      ],
    }))
    await flush()

    // test_runs must be first, assertion_results second
    expect(mockQuery.mock.calls[0]![0]).toContain('INSERT INTO test_runs')
    expect(mockQuery.mock.calls[1]![0]).toContain('INSERT INTO assertion_results')
    // 4 queries: test_runs + assertion_results + prev-state SELECT + test_state upsert
    expect(mockQuery).toHaveBeenCalledTimes(4)
    // 2 assertions × 6 params = 12 params
    const params = mockQuery.mock.calls[1]![1] as unknown[]
    expect(params).toHaveLength(12)
  })

  it('prevents concurrent flushes via flushInProgress guard', async () => {
    enqueue(makeResult({ id: 'r1' }))
    enqueue(makeResult({ id: 'r2' }))

    let resolveFirst!: () => void
    const firstCallBlock = new Promise<{ rows: [] }>(resolve => {
      resolveFirst = () => resolve({ rows: [] })
    })
    mockQuery.mockReturnValueOnce(firstCallBlock as never)

    const first = flush()
    const second = flush() // should be a no-op (flushInProgress = true)

    resolveFirst()
    mockQuery.mockResolvedValue({ rows: [] } as never)
    await first
    await second

    // first flush: 3 queries (test_runs + prev-state select + test_state upsert). second: 0 (guarded).
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })
})

describe('flushTestState deduplication', () => {
  it('upserts only the latest result per test_id', async () => {
    const early = makeResult({
      id: 'r-early',
      test_id: 'test-1',
      finished_at: new Date('2026-01-01T00:00:01Z'),
      status: 'fail',
    })
    const late = makeResult({
      id: 'r-late',
      test_id: 'test-1',
      finished_at: new Date('2026-01-01T00:00:02Z'),
      status: 'success',
    })

    enqueue(early)
    enqueue(late)
    await flush()

    const testStateCall = mockQuery.mock.calls[2]
    expect(testStateCall).toBeDefined()
    const params = testStateCall![1] as unknown[]
    // After dedup: 1 row × 3 params = 3 params
    expect(params).toHaveLength(3)
    // The kept row should be 'late' with status 'success'
    expect(params[0]).toBe('test-1')
    expect(params[1]).toBe('success')
    expect(params[2]).toEqual(new Date('2026-01-01T00:00:02Z'))
  })

  it('builds correct SQL with ON CONFLICT upsert', async () => {
    enqueue(makeResult())
    await flush()

    const testStateCall = mockQuery.mock.calls[2]
    const sql = testStateCall![0] as string
    expect(sql).toContain('INSERT INTO test_state')
    expect(sql).toContain('ON CONFLICT (test_id) DO UPDATE')
    expect(sql).toContain('consecutive_failures')
    expect(sql).toContain('public_status')
    expect(sql).not.toContain('last_notification_at')
  })
})

describe('enqueue immediate flush at 100 rows', () => {
  it('triggers flush when buffer reaches 100', async () => {
    // We need to observe that flush was called — use a spy on pool.query
    for (let i = 0; i < 99; i++) {
      enqueue(makeResult({ id: `r${i}`, test_id: `test-${i}` }))
    }
    expect(mockQuery).not.toHaveBeenCalled() // not yet

    // 100th enqueue should trigger flush (fire-and-forget)
    enqueue(makeResult({ id: 'r99', test_id: 'test-99' }))

    // The flush is async/fire-and-forget; wait a tick
    await new Promise(r => setTimeout(r, 0))
    expect(mockQuery).toHaveBeenCalled()
  })
})

describe('startFlusher / stopFlusher', () => {
  it('stopFlusher is safe to call when flusher is not running', () => {
    expect(() => stopFlusher()).not.toThrow()
  })

  it('startFlusher is idempotent: calling twice does not create two intervals', async () => {
    vi.useFakeTimers()
    startFlusher()
    startFlusher() // second call should be a no-op
    enqueue(makeResult())
    await vi.advanceTimersByTimeAsync(2000) // drains microtasks too
    // Only one interval should fire: 3 queries expected (1 flush cycle)
    expect(mockQuery).toHaveBeenCalledTimes(3)
    stopFlusher()
    vi.useRealTimers()
  })

  it('stopFlusher prevents further flushes after being called', async () => {
    vi.useFakeTimers()
    startFlusher()
    enqueue(makeResult())
    stopFlusher()
    await vi.advanceTimersByTimeAsync(4000)
    expect(mockQuery).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
