import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the pool before importing the module under test. Every chunk runs in a transaction on
// one client from pool.connect(); the mocked client records each query.
const clientQuery = vi.fn()
const release = vi.fn()

vi.mock('./pool.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn(async () => ({ query: clientQuery, release })),
  },
}))
vi.mock('../notifier/dispatch.js', () => ({ triggerNotifications: vi.fn() }))

import { triggerNotifications } from '../notifier/dispatch.js'
import { CHUNK_SIZE, MAX_BUFFERED_ROWS, bufferedCount, drain, enqueue, flush, isTransientDbError, startFlusher, stopFlusher } from './result-buffer.js'
import type { RunResult } from '../executor/run.js'

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: overrides.id ?? 'run-1',
    test_id: overrides.test_id ?? 'test-1',
    started_at: overrides.started_at ?? new Date('2026-01-01T00:00:00Z'),
    finished_at: overrides.finished_at ?? new Date('2026-01-01T00:00:01Z'),
    status: overrides.status ?? 'success',
    duration_ms: overrides.duration_ms ?? 100,
    error_message: overrides.error_message ?? null,
    assertions: overrides.assertions ?? [],
  }
}

/** Every test id the chunk asks about exists, unless listed in `deleted`. */
let deleted = new Set<string>()
/** Run ids whose INSERT the database rejects as a constraint violation. */
let poison = new Set<string>()

function pgError(code: string, message = 'boom'): Error {
  return Object.assign(new Error(message), { code })
}

function defaultQuery(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
  if (sql.startsWith('SELECT id FROM tests')) {
    const ids = (params?.[0] as string[]) ?? []
    return Promise.resolve({ rows: ids.filter((id) => !deleted.has(id)).map((id) => ({ id })) })
  }
  if (sql.includes('INSERT INTO test_runs')) {
    const ids = (params ?? []).filter((_, i) => i % 7 === 0) as string[]
    if (ids.some((id) => poison.has(id))) return Promise.reject(pgError('23503', 'violates foreign key constraint'))
  }
  return Promise.resolve({ rows: [] })
}

/** Holds the next client query until release(); `started` resolves once the query was issued. */
function holdNextQuery(): { started: Promise<void>; release: () => void } {
  let onStart!: () => void
  let resolveQuery: (() => void) | null = null
  const started = new Promise<void>((r) => { onStart = r })
  clientQuery.mockImplementationOnce(() => new Promise((r) => {
    resolveQuery = () => r({ rows: [] })
    onStart()
  }))
  return { started, release: () => resolveQuery?.() }
}

const sqls = () => clientQuery.mock.calls.map((c) => String(c[0]))
const callsMatching = (s: string) => clientQuery.mock.calls.filter((c) => String(c[0]).includes(s))

beforeEach(async () => {
  deleted = new Set()
  poison = new Set()
  clientQuery.mockReset()
  clientQuery.mockImplementation(defaultQuery)
  release.mockClear()
  vi.mocked(triggerNotifications).mockClear()
  // start every test with an empty buffer
  await flush().catch(() => {})
  clientQuery.mockClear()
})

afterEach(() => {
  stopFlusher()
  vi.useRealTimers()
})

describe('flush', () => {
  it('is a no-op when buffer is empty', async () => {
    await flush()
    expect(clientQuery).not.toHaveBeenCalled()
  })

  it('writes one result in a transaction: runs, state, commit', async () => {
    enqueue(makeResult())
    await flush()
    const s = sqls()
    expect(s[0]).toBe('BEGIN')
    expect(s.some((q) => q.includes('INSERT INTO test_runs'))).toBe(true)
    expect(s.some((q) => q.includes('INSERT INTO test_state'))).toBe(true)
    expect(s.at(-1)).toBe('COMMIT')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('inserts all rows of a chunk in a single test_runs statement', async () => {
    enqueue(makeResult({ id: 'r1', test_id: 'test-1' }))
    enqueue(makeResult({ id: 'r2', test_id: 'test-2' }))
    enqueue(makeResult({ id: 'r3', test_id: 'test-3' }))
    await flush()
    const runs = callsMatching('INSERT INTO test_runs')
    expect(runs).toHaveLength(1)
    expect(runs[0]![1]).toHaveLength(21) // 3 rows × 7 params
  })

  it('splits large flushes into chunks of 100, one transaction each', async () => {
    stopFlusher()
    // enqueue() would flush at 100 on its own; queue through a held flush instead
    const hold = holdNextQuery()
    enqueue(makeResult({ id: 'first' }))
    const first = flush()
    for (let i = 0; i < 250; i++) enqueue(makeResult({ id: `r${i}`, test_id: `t${i % 7}` }))
    await hold.started
    hold.release()
    await first
    clientQuery.mockClear()
    await flush()
    const runs = callsMatching('INSERT INTO test_runs')
    expect(runs.map((c) => (c[1] as unknown[]).length / 7)).toEqual([100, 100, 50])
    expect(sqls().filter((q) => q === 'BEGIN')).toHaveLength(3)
  })

  it('drains the buffer: a second flush with no new enqueues is a no-op', async () => {
    enqueue(makeResult())
    await flush()
    clientQuery.mockClear()
    await flush()
    expect(clientQuery).not.toHaveBeenCalled()
  })

  it('re-queues rows and re-throws when the database is unreachable', async () => {
    clientQuery.mockImplementation((sql: string) =>
      sql === 'BEGIN' ? Promise.reject(new Error('connect ECONNREFUSED')) : Promise.resolve({ rows: [] }),
    )
    enqueue(makeResult({ id: 'r1' }))
    await expect(flush()).rejects.toThrow('ECONNREFUSED')
    expect(bufferedCount()).toBe(1)

    clientQuery.mockImplementation(defaultQuery)
    await flush()
    expect(bufferedCount()).toBe(0)
  })

  it('isolates a rejected row, drops it and writes the rest', async () => {
    poison.add('bad')
    enqueue(makeResult({ id: 'good-1', test_id: 'a' }))
    enqueue(makeResult({ id: 'bad', test_id: 'b' }))
    enqueue(makeResult({ id: 'good-2', test_id: 'c' }))
    await flush()
    // the chunk failed, then each row was written on its own
    const committed = clientQuery.mock.calls.filter((c) => c[0] === 'COMMIT')
    expect(committed).toHaveLength(2)
    expect(sqls().filter((q) => q === 'ROLLBACK')).toHaveLength(2)
    expect(bufferedCount()).toBe(0)
    // later flushes are not blocked
    clientQuery.mockClear()
    enqueue(makeResult({ id: 'next', test_id: 'a' }))
    await flush()
    expect(callsMatching('INSERT INTO test_runs')).toHaveLength(1)
  })

  it('drops runs of a deleted test before inserting', async () => {
    deleted.add('gone')
    enqueue(makeResult({ id: 'r1', test_id: 'gone' }))
    enqueue(makeResult({ id: 'r2', test_id: 'kept' }))
    await flush()
    const runs = callsMatching('INSERT INTO test_runs')
    expect(runs).toHaveLength(1)
    expect((runs[0]![1] as unknown[])[0]).toBe('r2')
    expect(bufferedCount()).toBe(0)
  })

  it('skips the runs insert entirely when every test was deleted', async () => {
    deleted.add('gone')
    enqueue(makeResult({ id: 'r1', test_id: 'gone' }))
    await flush()
    expect(callsMatching('INSERT INTO test_runs')).toHaveLength(0)
    expect(sqls().at(-1)).toBe('COMMIT')
  })

  it('caps the buffer, dropping the oldest rows', async () => {
    clientQuery.mockImplementation((sql: string) =>
      sql === 'BEGIN' ? Promise.reject(new Error('Connection terminated')) : Promise.resolve({ rows: [] }),
    )
    for (let i = 0; i < MAX_BUFFERED_ROWS + 50; i++) enqueue(makeResult({ id: `r${i}` }))
    await flush().catch(() => {})
    await new Promise((r) => setTimeout(r, 0))
    expect(bufferedCount()).toBeLessThanOrEqual(MAX_BUFFERED_ROWS)
    clientQuery.mockImplementation(defaultQuery)
    await drain()
    expect(bufferedCount()).toBe(0)
  })

  it('skips assertion_results insert when result has no assertions', async () => {
    enqueue(makeResult())
    await flush()
    expect(callsMatching('assertion_results')).toHaveLength(0)
  })

  it('inserts assertion_results after test_runs when assertions are present', async () => {
    enqueue(makeResult({
      assertions: [
        { id: 'a1', name: 'status 200', passed: true, message: null },
        { id: 'a2', name: 'body ok', passed: false, message: 'missing field' },
      ],
    }))
    await flush()
    const s = sqls()
    const runsIdx = s.findIndex((q) => q.includes('INSERT INTO test_runs'))
    const assertIdx = s.findIndex((q) => q.includes('INSERT INTO assertion_results'))
    expect(assertIdx).toBeGreaterThan(runsIdx)
    expect(clientQuery.mock.calls[assertIdx]![1]).toHaveLength(12)
  })

  it('joins a flush already in flight instead of starting a second one', async () => {
    enqueue(makeResult({ id: 'r1' }))
    const hold = holdNextQuery()
    const first = flush()
    const second = flush()
    expect(second).toBe(first)
    await hold.started
    hold.release()
    await Promise.all([first, second])
    expect(sqls().filter((q) => q === 'BEGIN')).toHaveLength(1)
  })

  it('drain() waits for an in-flight flush and writes what was queued meanwhile', async () => {
    enqueue(makeResult({ id: 'r1', test_id: 'a' }))
    const hold = holdNextQuery()
    const first = flush()
    enqueue(makeResult({ id: 'r2', test_id: 'b' }))
    const drained = drain()
    await hold.started
    hold.release()
    await first
    await drained
    expect(bufferedCount()).toBe(0)
    expect(callsMatching('INSERT INTO test_runs')).toHaveLength(2)
  })

  it('notifies after commit with the state change', async () => {
    clientQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO test_state')) {
        return Promise.resolve({ rows: [{ test_id: 'test-1', test_name: 'T', public_status: 'degraded', prev_public_status: 'up', prev_last_status: 'success', consecutive_failures: 1 }] })
      }
      return defaultQuery(sql, params)
    })
    enqueue(makeResult({ status: 'fail', error_message: 'nope' }))
    await flush()
    expect(triggerNotifications).toHaveBeenCalledWith([
      { test_id: 'test-1', new_status: 'fail', prev_public_status: 'up', public_status: 'degraded', error_message: 'nope', duration_ms: 100, incident_id: null, incident_transition: null },
    ])
  })
})

describe('isTransientDbError', () => {
  it('retries connection and resource errors, drops data errors', () => {
    expect(isTransientDbError(new Error('connect ECONNREFUSED'))).toBe(true)
    expect(isTransientDbError(pgError('08006'))).toBe(true)
    expect(isTransientDbError(pgError('57P01'))).toBe(true)
    expect(isTransientDbError(pgError('40P01'))).toBe(true)
    expect(isTransientDbError(pgError('23503'))).toBe(false)
    expect(isTransientDbError(pgError('22P02'))).toBe(false)
    expect(isTransientDbError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true)
  })
})

describe('test_state upsert', () => {
  it('upserts only the latest result per test_id', async () => {
    enqueue(makeResult({ id: 'r-early', test_id: 'test-1', finished_at: new Date('2026-01-01T00:00:01Z'), status: 'fail' }))
    enqueue(makeResult({ id: 'r-late', test_id: 'test-1', finished_at: new Date('2026-01-01T00:00:02Z'), status: 'success' }))
    await flush()
    const params = callsMatching('INSERT INTO test_state')[0]![1] as unknown[]
    expect(params).toEqual(['test-1', 'success', new Date('2026-01-01T00:00:02Z'), 0])
  })

  it('builds correct SQL with ON CONFLICT upsert', async () => {
    enqueue(makeResult())
    await flush()
    const sql = String(callsMatching('INSERT INTO test_state')[0]![0])
    expect(sql).toContain('ON CONFLICT (test_id) DO UPDATE')
    expect(sql).toContain('consecutive_failures')
    expect(sql).toContain('public_status')
    expect(sql).not.toContain('last_notification_at')
    // warnings are not failures: only fail and timeout extend the streak
    expect(sql).toContain("v.last_status IN ('fail','timeout')")
  })

  it('maintains the problem window in the same upsert', async () => {
    enqueue(makeResult())
    await flush()
    const sql = String(callsMatching('INSERT INTO test_state')[0]![0])
    for (const col of ['problem_started_at', 'problem_ended_at', 'problem_worst', 'last_problem_at']) {
      expect(sql).toMatch(new RegExp(`${col}\\s+=\\s+EXCLUDED\\.${col}`))
    }
    expect(sql).toContain("public_status <> 'up' AND prev_public_status IN ('up', 'unknown') THEN last_run_at")
    expect(sql).toContain("WHEN prev_public_status IN ('down', 'degraded') THEN last_run_at")
    expect(sql).toContain("CASE WHEN last_status <> 'success' THEN last_run_at ELSE prev_last_problem_at END")
  })
})

describe('enqueue immediate flush', () => {
  it(`triggers a flush when the buffer reaches ${CHUNK_SIZE}`, async () => {
    for (let i = 0; i < CHUNK_SIZE - 1; i++) enqueue(makeResult({ id: `r${i}`, test_id: `test-${i}` }))
    expect(clientQuery).not.toHaveBeenCalled()
    enqueue(makeResult({ id: 'last', test_id: 'test-last' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(clientQuery).toHaveBeenCalled()
    await flush()
  })
})

describe('startFlusher / stopFlusher', () => {
  it('stopFlusher is safe to call when flusher is not running', () => {
    expect(() => stopFlusher()).not.toThrow()
  })

  it('startFlusher is idempotent: calling twice does not create two intervals', async () => {
    vi.useFakeTimers()
    startFlusher()
    startFlusher()
    enqueue(makeResult())
    await vi.advanceTimersByTimeAsync(2000)
    expect(sqls().filter((q) => q === 'BEGIN')).toHaveLength(1)
  })

  it('stopFlusher prevents further flushes after being called', async () => {
    vi.useFakeTimers()
    startFlusher()
    enqueue(makeResult())
    stopFlusher()
    await vi.advanceTimersByTimeAsync(4000)
    expect(clientQuery).not.toHaveBeenCalled()
    vi.useRealTimers()
    await flush()
  })
})
