/**
 * The status window in the state upsert, against real Postgres: the SQL in result-buffer.ts
 * must agree with publicStatusFor() in @sentinel/shared at every step. Skips without a database.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { isFailure, nextConsecutiveFailures, publicStatusFor, type PublicStatusOutcome, type TestStatus } from '@sentinel/shared'

const WINDOW_MS = 10 * 60_000

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  STATUS_WINDOW_MS: 10 * 60_000,
}))

const { enqueue, flush, stopFlusher } = await import('./result-buffer.js')

const DATABASE_URL = process.env['DATABASE_URL']

async function checkDbAvailable(): Promise<boolean> {
  if (!DATABASE_URL) return false
  const probe = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 })
  try {
    await probe.connect()
    await probe.end()
    return true
  } catch {
    return false
  }
}

const dbAvailable = await checkDbAvailable()
const client = new pg.Client({ connectionString: DATABASE_URL! })
const TEST_ID = 'integ-window-fixture'

beforeAll(async () => {
  if (!dbAvailable) return
  await client.connect()
  await client.query(
    `INSERT INTO tests (id, name, code, schedule_ms, timeout_ms, retries, uses_browser, enabled, failure_threshold)
     VALUES ($1, '__integration test fixture (status window)', 'return true', 60000, 5000, 0, false, false, 2)
     ON CONFLICT (id) DO UPDATE SET failure_threshold = 2`,
    [TEST_ID],
  )
})

afterAll(async () => {
  if (!dbAvailable) return
  stopFlusher()
  await client.query(`DELETE FROM tests WHERE id = $1`, [TEST_ID])
  await client.end()
})

describe.skipIf(!dbAvailable)('status window in the state upsert', () => {
  it('computes the same state in SQL as publicStatusFor() with a window', async () => {
    // [minutes after start, result]: a long failure, a recovery that has to hold, a blip.
    const runs: Array<[number, TestStatus]> = [
      [0, 'success'],
      [1, 'fail'], [2, 'fail'], [6, 'fail'], [11, 'fail'], [12, 'timeout'],
      [13, 'success'], [18, 'success'], [22, 'fail'], [23, 'success'], [30, 'success'], [33, 'success'],
      [34, 'warn'], [35, 'success'], [46, 'success'],
    ]
    const start = Date.now() - 60 * 60_000
    let consecutive = 0
    let previous: PublicStatusOutcome = 'unknown'
    let failingSince: number | null = null
    let succeedingSince: number | null = null
    const seen: string[] = []

    for (const [i, [minute, status]] of runs.entries()) {
      const at = start + minute * 60_000
      enqueue({
        id: `integ-window-${i}`,
        test_id: TEST_ID,
        started_at: new Date(at - 50),
        finished_at: new Date(at),
        status,
        duration_ms: 50,
        error_message: null,
        assertions: [],
      })
      await flush()

      consecutive = nextConsecutiveFailures(status, consecutive)
      failingSince = isFailure(status) ? (failingSince ?? at) : null
      succeedingSince = status === 'success' ? (succeedingSince ?? at) : null
      const expected = publicStatusFor(status, consecutive, 2, {
        windowMs: WINDOW_MS,
        failingForMs: failingSince === null ? 0 : at - failingSince,
        passingForMs: succeedingSince === null ? 0 : at - succeedingSince,
        previous,
      })
      previous = expected

      const { rows } = await client.query<{ public_status: string }>(
        `SELECT public_status FROM test_state WHERE test_id = $1`,
        [TEST_ID],
      )
      expect({ step: i, minute, status: rows[0]?.public_status }).toEqual({ step: i, minute, status: expected })
      seen.push(expected)
    }

    // The window did its job: Outage only after 10 min of failing, Operational only after 10 min of passing.
    expect(seen).toEqual([
      'up',
      'degraded', 'degraded', 'degraded', 'down', 'down',
      'degraded', 'degraded', 'degraded', 'degraded', 'degraded', 'up',
      'degraded', 'degraded', 'up',
    ])
  })
})
