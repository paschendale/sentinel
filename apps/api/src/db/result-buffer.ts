import type pg from 'pg'
import type { PublicStatusOutcome, TestStatus } from '@sentinel/shared'
import { FAILURE_STATUSES } from '@sentinel/shared'
import type { RunResult } from '../executor/run.js'
import { logger } from '../logger.js'
import { pool } from './pool.js'
import { triggerNotifications } from '../notifier/dispatch.js'
import { recordTestResult } from '../metrics/index.js'

const log = logger.child({ component: 'result-buffer' })

/** Rows written per statement and per transaction. */
export const CHUNK_SIZE = 100
/** Most rows kept in memory while the database is unreachable; the oldest are dropped beyond it. */
export const MAX_BUFFERED_ROWS = 5000

/** SQL list of the statuses that count as failures, e.g. `'fail','timeout'`. */
const FAILURE_SQL = FAILURE_STATUSES.map((s) => `'${s}'`).join(',')

let buffer: RunResult[] = []
let flusherTimer: ReturnType<typeof setInterval> | null = null
let inFlight: Promise<void> | null = null

/** One test's state change from a flushed chunk (the latest run of that test in the chunk). */
export interface StateTransition {
  test_id: string
  test_name: string
  run: RunResult
  prev_last_status: TestStatus | null
  prev_public_status: PublicStatusOutcome
  public_status: Exclude<PublicStatusOutcome, 'unknown'>
  consecutive_failures: number
}

export function enqueue(result: RunResult): void {
  buffer.push(result)
  capBuffer()
  if (buffer.length >= CHUNK_SIZE) {
    flush().catch((err: unknown) => {
      log.error({ event: 'result_buffer.flush_failed', err }, 'result-buffer: immediate flush failed')
    })
  }
}

export function bufferedCount(): number {
  return buffer.length
}

function capBuffer(): void {
  if (buffer.length <= MAX_BUFFERED_ROWS) return
  const dropped = buffer.splice(0, buffer.length - MAX_BUFFERED_ROWS)
  log.error(
    { event: 'result_buffer.overflow', dropped: dropped.length, run_ids: dropped.slice(0, 20).map((r) => r.id) },
    `result-buffer: buffer over ${MAX_BUFFERED_ROWS} rows, dropped the ${dropped.length} oldest`,
  )
}

export function startFlusher(): void {
  if (flusherTimer !== null) return
  flusherTimer = setInterval(() => {
    flush().catch((err: unknown) => {
      log.error({ event: 'result_buffer.flush_failed', err }, 'result-buffer: timed flush failed')
    })
  }, 2000)
}

export function stopFlusher(): void {
  if (flusherTimer !== null) {
    clearInterval(flusherTimer)
    flusherTimer = null
  }
}

/**
 * Writes the buffer. A flush already running is joined rather than started twice.
 * Rejects (after re-queuing) when the database could not be reached.
 */
export function flush(): Promise<void> {
  if (inFlight !== null) return inFlight
  if (buffer.length === 0) return Promise.resolve()
  inFlight = flushOnce().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Waits for an in-flight flush, then flushes until the buffer is empty or a flush fails. For shutdown. */
export async function drain(): Promise<void> {
  if (inFlight !== null) await inFlight.catch(() => {})
  while (buffer.length > 0) {
    const before = buffer.length
    try {
      await flush()
    } catch (err) {
      log.error({ event: 'result_buffer.drain_failed', err, remaining: buffer.length }, 'result-buffer: could not drain on shutdown')
      return
    }
    if (buffer.length >= before) return
  }
}

/** Connection, resource and shutdown errors: worth retrying later. Anything else is a bad row. */
export function isTransientDbError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return true
  return ['08', '40', '53', '57', '58'].includes(code.slice(0, 2))
}

async function flushOnce(): Promise<void> {
  const rows = buffer
  buffer = []
  let transientError: unknown = null
  const requeue: RunResult[] = []

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    if (transientError !== null) {
      requeue.push(...chunk)
      continue
    }
    try {
      await writeChunk(chunk)
    } catch (err) {
      if (isTransientDbError(err)) {
        transientError = err
        requeue.push(...chunk)
        continue
      }
      // One bad row (or a test deleted mid-flush) must not block the rest: write each row on
      // its own and drop the ones the database rejects.
      for (const row of chunk) {
        if (transientError !== null) {
          requeue.push(row)
          continue
        }
        try {
          await writeChunk([row])
        } catch (rowErr) {
          if (isTransientDbError(rowErr)) {
            transientError = rowErr
            requeue.push(row)
          } else {
            log.error(
              { event: 'result_buffer.row_dropped', err: rowErr, run_id: row.id, test_id: row.test_id, status: row.status },
              `result-buffer: dropped run ${row.id} of test ${row.test_id}: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`,
            )
          }
        }
      }
    }
  }

  if (requeue.length > 0) {
    buffer = [...requeue, ...buffer]
    capBuffer()
    throw transientError
  }
}

/** Writes runs, assertions and state for one chunk in one transaction; notifies after commit. */
async function writeChunk(rows: RunResult[]): Promise<void> {
  const client = await pool.connect()
  let transitions: StateTransition[] = []
  let written: RunResult[] = []
  try {
    await client.query('BEGIN')
    written = await dropRunsOfDeletedTests(client, rows)
    if (written.length > 0) {
      await insertTestRuns(client, written)
      await insertAssertions(client, written)
      transitions = await upsertTestState(client, written)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }

  for (const r of written) recordTestResult(r.status, r.duration_ms)
  if (transitions.length > 0) {
    // Fire-and-forget notification checks (F-07)
    triggerNotifications(
      transitions.map((t) => ({
        test_id: t.test_id,
        new_status: t.run.status,
        prev_status: t.prev_last_status,
        error_message: t.run.error_message,
        duration_ms: t.run.duration_ms,
      })),
    )
  }
}

async function dropRunsOfDeletedTests(client: pg.PoolClient, rows: RunResult[]): Promise<RunResult[]> {
  const ids = [...new Set(rows.map((r) => r.test_id))]
  const { rows: existing } = await client.query<{ id: string }>('SELECT id FROM tests WHERE id = ANY($1)', [ids])
  const live = new Set(existing.map((r) => r.id))
  const kept = rows.filter((r) => live.has(r.test_id))
  if (kept.length < rows.length) {
    const gone = rows.filter((r) => !live.has(r.test_id))
    log.warn(
      { event: 'result_buffer.deleted_test_runs_dropped', count: gone.length, test_ids: [...new Set(gone.map((r) => r.test_id))] },
      `result-buffer: dropped ${gone.length} run(s) of deleted test(s)`,
    )
  }
  return kept
}

async function insertTestRuns(client: pg.PoolClient, rows: RunResult[]): Promise<void> {
  const values: unknown[] = []
  const placeholders = rows.map((r, i) => {
    const b = i * 7
    values.push(r.id, r.test_id, r.started_at, r.finished_at, r.status, r.duration_ms, r.error_message)
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`
  })
  await client.query(
    `INSERT INTO test_runs (id, test_id, started_at, finished_at, status, duration_ms, error_message)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (id, started_at) DO NOTHING`,
    values,
  )
}

async function insertAssertions(client: pg.PoolClient, rows: RunResult[]): Promise<void> {
  const all = rows.flatMap((r) =>
    r.assertions.map((a) => ({ ...a, test_run_id: r.id, test_run_started_at: r.started_at })),
  )
  // Assertions are bounded per run by the executor, but a chunk of chatty runs can still add up.
  for (let i = 0; i < all.length; i += CHUNK_SIZE * 5) {
    const part = all.slice(i, i + CHUNK_SIZE * 5)
    const values: unknown[] = []
    const placeholders = part.map((a, j) => {
      const b = j * 6
      values.push(a.id, a.test_run_id, a.test_run_started_at, a.name, a.passed, a.message)
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`
    })
    await client.query(
      `INSERT INTO assertion_results (id, test_run_id, test_run_started_at, name, passed, message)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (id) DO NOTHING`,
      values,
    )
  }
}

interface UpsertRow {
  test_id: string
  test_name: string
  public_status: Exclude<PublicStatusOutcome, 'unknown'>
  prev_public_status: PublicStatusOutcome
  prev_last_status: TestStatus | null
  consecutive_failures: number
}

async function upsertTestState(client: pg.PoolClient, rows: RunResult[]): Promise<StateTransition[]> {
  // One row per test_id: keep the latest by finished_at.
  const latest = new Map<string, RunResult>()
  for (const r of rows) {
    const cur = latest.get(r.test_id)
    if (cur === undefined || r.finished_at > cur.finished_at) latest.set(r.test_id, r)
  }
  const deduped = Array.from(latest.values())

  const values: unknown[] = []
  const placeholders = deduped.map((r, i) => {
    const b = i * 3
    values.push(r.test_id, r.status, r.finished_at)
    return `($${b + 1}::text,$${b + 2}::text,$${b + 3}::timestamptz)`
  })

  // LEFT JOIN reads the previous state so consecutive_failures can be incremented and the
  // problem window (problem_started_at/ended_at/worst, last_problem_at) maintained; JOIN tests
  // reads failure_threshold so public_status is computed atomically. The final SELECT hands the
  // transition (previous → new state) back to the caller.
  const { rows: out } = await client.query<UpsertRow>(
    `WITH v(test_id, last_status, last_run_at) AS (VALUES ${placeholders.join(',')}),
     calc AS (
       SELECT
         v.test_id,
         t.name AS test_name,
         v.last_status,
         v.last_run_at,
         -- mirrors nextConsecutiveFailures() and publicStatusFor() in packages/shared/src/state.ts
         CASE WHEN v.last_status IN (${FAILURE_SQL}) THEN COALESCE(ts.consecutive_failures, 0) + 1
              ELSE 0
         END AS consecutive_failures,
         CASE
           WHEN v.last_status = 'success' THEN 'up'
           WHEN v.last_status IN (${FAILURE_SQL})
                AND (COALESCE(ts.consecutive_failures, 0) + 1) >= GREATEST(t.failure_threshold, 1) THEN 'down'
           ELSE 'degraded'
         END AS public_status,
         ts.last_status AS prev_last_status,
         COALESCE(ts.public_status, 'unknown') AS prev_public_status,
         ts.problem_started_at AS prev_started_at,
         ts.problem_ended_at   AS prev_ended_at,
         ts.problem_worst      AS prev_worst,
         ts.last_problem_at    AS prev_last_problem_at
       FROM v
       LEFT JOIN test_state ts ON ts.test_id = v.test_id
       JOIN tests t ON t.id = v.test_id
     ),
     upserted AS (
       INSERT INTO test_state (test_id, last_status, consecutive_failures, last_run_at, public_status,
                               problem_started_at, problem_ended_at, problem_worst, last_problem_at)
       SELECT
         test_id,
         last_status,
         consecutive_failures,
         last_run_at,
         public_status,
         -- a new streak starts when a non-passing state follows a passing (or unknown) one
         CASE WHEN public_status <> 'up' AND prev_public_status IN ('up', 'unknown') THEN last_run_at
              ELSE prev_started_at END,
         -- the streak ends on the first passing run after it; it stays open while the state is not up
         CASE WHEN public_status <> 'up' THEN NULL
              WHEN prev_public_status IN ('down', 'degraded') THEN last_run_at
              ELSE prev_ended_at END,
         CASE WHEN public_status = 'up' THEN prev_worst
              WHEN prev_public_status IN ('up', 'unknown') THEN public_status
              WHEN public_status = 'down' OR prev_worst = 'down' THEN 'down'
              ELSE 'degraded' END,
         CASE WHEN last_status <> 'success' THEN last_run_at ELSE prev_last_problem_at END
       FROM calc
       ON CONFLICT (test_id) DO UPDATE SET
         last_status          = EXCLUDED.last_status,
         consecutive_failures = EXCLUDED.consecutive_failures,
         last_run_at          = EXCLUDED.last_run_at,
         public_status        = EXCLUDED.public_status,
         problem_started_at   = EXCLUDED.problem_started_at,
         problem_ended_at     = EXCLUDED.problem_ended_at,
         problem_worst        = EXCLUDED.problem_worst,
         last_problem_at      = EXCLUDED.last_problem_at
       RETURNING test_id
     )
     SELECT c.test_id, c.test_name, c.public_status, c.prev_public_status, c.prev_last_status, c.consecutive_failures
     FROM calc c JOIN upserted u ON u.test_id = c.test_id`,
    values,
  )

  return out.map((r) => ({
    test_id: r.test_id,
    test_name: r.test_name,
    run: latest.get(r.test_id)!,
    prev_last_status: r.prev_last_status,
    prev_public_status: r.prev_public_status,
    public_status: r.public_status,
    consecutive_failures: Number(r.consecutive_failures),
  }))
}
