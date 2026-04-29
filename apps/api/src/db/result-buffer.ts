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
     VALUES ${placeholders.join(',')}`,
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
    return `($${b + 1},$${b + 2},$${b + 3}::timestamptz)`
  })

  // LEFT JOIN reads existing consecutive_failures so it can be incremented correctly.
  // JOIN tests to read failure_threshold and compute public_status atomically.
  await pool.query(
    `INSERT INTO test_state (test_id, last_status, consecutive_failures, last_run_at, public_status)
     SELECT
       v.test_id,
       v.last_status,
       CASE WHEN v.last_status = 'success' OR v.last_status = 'warn' THEN 0
            ELSE COALESCE(ts.consecutive_failures, 0) + 1
       END,
       v.last_run_at,
       CASE
         WHEN v.last_status = 'success' THEN 'up'
         WHEN v.last_status = 'warn' THEN 'degraded'
         WHEN (COALESCE(ts.consecutive_failures, 0) + 1) >= t.failure_threshold THEN 'down'
         ELSE 'degraded'
       END
     FROM (VALUES ${placeholders.join(',')}) AS v(test_id, last_status, last_run_at)
     LEFT JOIN test_state ts ON ts.test_id = v.test_id
     JOIN tests t ON t.id = v.test_id
     ON CONFLICT (test_id) DO UPDATE SET
       last_status          = EXCLUDED.last_status,
       consecutive_failures = EXCLUDED.consecutive_failures,
       last_run_at          = EXCLUDED.last_run_at,
       public_status        = EXCLUDED.public_status`,
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
