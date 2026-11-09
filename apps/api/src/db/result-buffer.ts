import type { TestStatus } from '@sentinel/shared'
import type { RunResult } from '../executor/run.js'
import { pool } from './pool.js'
import { triggerNotifications } from '../notifier/dispatch.js'
import { recordTestResult } from '../metrics/index.js'

let buffer: RunResult[] = []
let flusherTimer: ReturnType<typeof setInterval> | null = null
let flushInProgress = false

export function enqueue(result: RunResult): void {
  buffer.push(result)
  if (buffer.length >= 100) {
    flush().catch((err: unknown) => {
      console.error('result-buffer: immediate flush failed', err)
    })
  }
}

export function startFlusher(): void {
  if (flusherTimer !== null) return
  flusherTimer = setInterval(() => {
    flush().catch((err: unknown) => {
      console.error('result-buffer: timed flush failed', err)
    })
  }, 2000)
}

export function stopFlusher(): void {
  if (flusherTimer !== null) {
    clearInterval(flusherTimer)
    flusherTimer = null
  }
}

export async function flush(): Promise<void> {
  if (flushInProgress || buffer.length === 0) return
  flushInProgress = true
  const rows = buffer
  buffer = []
  try {
    await flushTestRuns(rows)
    await flushAssertions(rows)
    await flushTestState(rows)
    for (const r of rows) {
      recordTestResult(r.status, r.duration_ms)
    }
  } catch (err) {
    buffer = [...rows, ...buffer]
    throw err
  } finally {
    flushInProgress = false
  }
}

async function flushTestRuns(rows: RunResult[]): Promise<void> {
  const values: unknown[] = []
  const placeholders = rows.map((r, i) => {
    const b = i * 7
    values.push(r.id, r.test_id, r.started_at, r.finished_at, r.status, r.duration_ms, r.error_message)
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`
  })
  await pool.query(
    `INSERT INTO test_runs (id, test_id, started_at, finished_at, status, duration_ms, error_message)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (id, started_at) DO NOTHING`,
    values,
  )
}

async function flushAssertions(rows: RunResult[]): Promise<void> {
  const all = rows.flatMap((r) =>
    r.assertions.map((a) => ({ ...a, test_run_id: r.id, test_run_started_at: r.started_at })),
  )
  if (all.length === 0) return
  const values: unknown[] = []
  const placeholders = all.map((a, i) => {
    const b = i * 6
    values.push(a.id, a.test_run_id, a.test_run_started_at, a.name, a.passed, a.message)
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`
  })
  await pool.query(
    `INSERT INTO assertion_results (id, test_run_id, test_run_started_at, name, passed, message)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (id) DO NOTHING`,
    values,
  )
}

async function flushTestState(rows: RunResult[]): Promise<void> {
  // Deduplicate: one row per test_id, keep the latest by finished_at
  const latest = new Map<string, RunResult>()
  for (const r of rows) {
    const cur = latest.get(r.test_id)
    if (cur === undefined || r.finished_at > cur.finished_at) latest.set(r.test_id, r)
  }
  const deduped = Array.from(latest.values())

  // Fetch previous statuses for transition detection (F-07)
  const testIds = deduped.map(r => r.test_id)
  const prevResult = await pool.query<{ test_id: string; last_status: TestStatus | null }>(
    `SELECT test_id, last_status FROM test_state WHERE test_id = ANY($1)`,
    [testIds],
  )
  const prevStates = new Map(prevResult.rows.map(r => [r.test_id, r.last_status]))

  const values: unknown[] = []
  const placeholders = deduped.map((r, i) => {
    const b = i * 3
    values.push(r.test_id, r.status, r.finished_at)
    return `($${b + 1}::text,$${b + 2}::text,$${b + 3}::timestamptz)`
  })

  // LEFT JOIN reads the previous state so consecutive_failures can be incremented and the
  // problem window (problem_started_at/ended_at/worst, last_problem_at) maintained; JOIN tests
  // reads failure_threshold so public_status is computed atomically.
  await pool.query(
    `WITH v(test_id, last_status, last_run_at) AS (VALUES ${placeholders.join(',')}),
     calc AS (
       SELECT
         v.test_id,
         v.last_status,
         v.last_run_at,
         CASE WHEN v.last_status = 'success' OR v.last_status = 'warn' THEN 0
              ELSE COALESCE(ts.consecutive_failures, 0) + 1
         END AS consecutive_failures,
         CASE
           WHEN v.last_status = 'success' THEN 'up'
           WHEN v.last_status = 'warn' THEN 'degraded'
           WHEN (COALESCE(ts.consecutive_failures, 0) + 1) >= t.failure_threshold THEN 'down'
           ELSE 'degraded'
         END AS public_status,
         COALESCE(ts.public_status, 'unknown') AS prev_public_status,
         ts.problem_started_at AS prev_started_at,
         ts.problem_ended_at   AS prev_ended_at,
         ts.problem_worst      AS prev_worst,
         ts.last_problem_at    AS prev_last_problem_at
       FROM v
       LEFT JOIN test_state ts ON ts.test_id = v.test_id
       JOIN tests t ON t.id = v.test_id
     )
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
       last_problem_at      = EXCLUDED.last_problem_at`,
    values,
  )

  // Fire-and-forget notification checks (F-07)
  triggerNotifications(
    deduped.map(r => ({
      test_id: r.test_id,
      new_status: r.status,
      prev_status: prevStates.get(r.test_id) ?? null,
      error_message: r.error_message,
      duration_ms: r.duration_ms,
    })),
  )
}
