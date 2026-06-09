/**
 * Integration tests for result-buffer — hits real Postgres.
 *
 * Requires DATABASE_URL pointing to a reachable Postgres instance
 * (reads from .env via global-setup.ts, or set directly in environment).
 * Creates a temporary test row for use as test_id (test_runs has a real FK).
 * Cleans up via CASCADE on delete in afterAll.
 * Skips gracefully when no reachable database is available.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import { enqueue, flush, startFlusher, stopFlusher } from './result-buffer.js'

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
let TEST_ID: string

beforeAll(async () => {
  await client.connect()
  // Insert a temporary test row — test_runs has a real FK to tests.id
  const { rows } = await client.query<{ id: string }>(`
    INSERT INTO tests (id, name, code, schedule_ms, timeout_ms, retries, uses_browser, enabled)
    VALUES (
      'integ-buffer-test-fixture',
      '__integration test fixture (result-buffer)',
      'return true',
      60000, 5000, 0, false, false
    )
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `)
  TEST_ID = rows[0]!.id
})

afterEach(async () => {
  stopFlusher()
  await flush().catch(() => {})
  // test_runs rows cascade-delete when the test is deleted,
  // but delete them explicitly here to keep the fixture test row alive for the next test
  await client.query(`DELETE FROM test_runs WHERE test_id = $1`, [TEST_ID])
  await client.query(`DELETE FROM test_state WHERE test_id = $1`, [TEST_ID])
})

afterAll(async () => {
  await client.query(`DELETE FROM tests WHERE id = $1`, [TEST_ID])
  await client.end()
})

function makeResult(overrides: {
  id?: string
  status?: 'success' | 'fail' | 'timeout'
  finished_at?: Date
} = {}) {
  const now = new Date()
  return {
    id: overrides.id ?? `integ-run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    test_id: TEST_ID,
    started_at: now,
    finished_at: overrides.finished_at ?? new Date(now.getTime() + 100),
    status: overrides.status ?? ('success' as const),
    duration_ms: 100,
    error_message: null,
    assertions: [] as Array<{ id: string; name: string; passed: boolean; message: string | null }>,
  }
}

describe.skipIf(!dbAvailable)('result-buffer integration', () => {
  it('persists a test_run row to Postgres after flush', async () => {
    const result = makeResult({ id: 'integ-run-single' })
    enqueue(result)
    await flush()

    const { rows } = await client.query<{ id: string; status: string; duration_ms: number }>(
      `SELECT id, test_id, status, duration_ms FROM test_runs WHERE id = $1`,
      [result.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: result.id,
      status: 'success',
      duration_ms: 100,
    })
  })

  it('upserts test_state after flush', async () => {
    enqueue(makeResult({ id: 'integ-run-state' }))
    await flush()

    const { rows } = await client.query<{ test_id: string; last_status: string; last_run_at: Date }>(
      `SELECT test_id, last_status, last_run_at FROM test_state WHERE test_id = $1`,
      [TEST_ID],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.last_status).toBe('success')
    expect(rows[0]!.last_run_at).toBeInstanceOf(Date)
  })

  it('persists a batch of rows in a single flush', async () => {
    const ids = ['integ-batch-1', 'integ-batch-2', 'integ-batch-3']
    for (const id of ids) {
      enqueue(makeResult({ id }))
    }
    await flush()

    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM test_runs WHERE test_id = $1 ORDER BY id`,
      [TEST_ID],
    )
    expect(rows.map(r => r.id).sort()).toEqual(ids.sort())
  })

  it('increments consecutive_failures for fail runs', async () => {
    enqueue(makeResult({ id: 'integ-cf-1', status: 'fail' }))
    await flush()

    const { rows: r1 } = await client.query<{ consecutive_failures: number }>(
      `SELECT consecutive_failures FROM test_state WHERE test_id = $1`,
      [TEST_ID],
    )
    expect(r1[0]!.consecutive_failures).toBe(1)

    enqueue(makeResult({ id: 'integ-cf-2', status: 'fail' }))
    await flush()

    const { rows: r2 } = await client.query<{ consecutive_failures: number }>(
      `SELECT consecutive_failures FROM test_state WHERE test_id = $1`,
      [TEST_ID],
    )
    expect(r2[0]!.consecutive_failures).toBe(2)
  })

  it('resets consecutive_failures to 0 on success after failures', async () => {
    enqueue(makeResult({ id: 'integ-reset-f1', status: 'fail' }))
    await flush()
    enqueue(makeResult({ id: 'integ-reset-f2', status: 'fail' }))
    await flush()

    enqueue(makeResult({ id: 'integ-reset-ok', status: 'success' }))
    await flush()

    const { rows } = await client.query<{ consecutive_failures: number; last_status: string }>(
      `SELECT consecutive_failures, last_status FROM test_state WHERE test_id = $1`,
      [TEST_ID],
    )
    expect(rows[0]!.consecutive_failures).toBe(0)
    expect(rows[0]!.last_status).toBe('success')
  })

  it('does not write last_notification_at (must stay null)', async () => {
    enqueue(makeResult({ id: 'integ-notif-check' }))
    await flush()

    const { rows } = await client.query<{ last_notification_at: Date | null }>(
      `SELECT last_notification_at FROM test_state WHERE test_id = $1`,
      [TEST_ID],
    )
    expect(rows[0]!.last_notification_at).toBeNull()
  })

  it('results appear in DB within 3 seconds via the timer (no manual flush)', async () => {
    const result = makeResult({ id: 'integ-timer-flush' })
    enqueue(result)

    // Start the real flusher and wait for the 2s interval to fire
    startFlusher()
    await new Promise(r => setTimeout(r, 2500))
    stopFlusher()

    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM test_runs WHERE id = $1`,
      [result.id],
    )
    expect(rows).toHaveLength(1)
  })
})
