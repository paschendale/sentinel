import type { PublicStatusOutcome, TestStatus } from '@sentinel/shared'
import type { RunResult } from '../executor/run.js'
import { pool } from './pool.js'
import { triggerNotifications } from '../notifier/dispatch.js'
import { recordTestResult } from '../metrics/index.js'
import { computePublicStatus } from './public-status.js'
import { PUBLIC_STATUS_WINDOW_MS } from '../config.js'

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

  // Fetch previous state for transition detection (F-07) and for public_status's window logic,
  // which needs to know whether a failure/recovery streak is already in progress.
  const testIds = deduped.map(r => r.test_id)
  const prevResult = await pool.query<{
    test_id: string
    last_status: TestStatus | null
    public_status: PublicStatusOutcome | null
    failing_since: Date | null
    succeeding_since: Date | null
  }>(
    `SELECT test_id, last_status, public_status, failing_since, succeeding_since FROM test_state WHERE test_id = ANY($1)`,
    [testIds],
  )
  const prevStates = new Map(prevResult.rows.map(r => [r.test_id, r]))

  // public_status (and its failing_since/succeeding_since streak markers) is computed here in JS
  // — see public-status.ts — rather than in SQL, since notifications below need the exact same
  // window decision and this way there is only one place that makes it.
  const computed = deduped.map(r => {
    const prev = prevStates.get(r.test_id) ?? null
    const next = computePublicStatus(
      {
        public_status: prev?.public_status ?? null,
        failing_since: prev?.failing_since ?? null,
        succeeding_since: prev?.succeeding_since ?? null,
      },
      r.status,
      r.finished_at,
      PUBLIC_STATUS_WINDOW_MS,
    )
    return { result: r, prevPublicStatus: prev?.public_status ?? null, ...next }
  })

  const values: unknown[] = []
  const placeholders = computed.map((c, i) => {
    const b = i * 6
    values.push(c.result.test_id, c.result.status, c.result.finished_at, c.public_status, c.failing_since, c.succeeding_since)
    return `($${b + 1},$${b + 2},$${b + 3}::timestamptz,$${b + 4},$${b + 5}::timestamptz,$${b + 6}::timestamptz)`
  })

  // LEFT JOIN reads existing consecutive_failures so it can be incremented correctly. It's kept
  // for display/audit only now — public_status no longer derives from it (or from
  // tests.failure_threshold); see public-status.ts.
  await pool.query(
    `INSERT INTO test_state (test_id, last_status, consecutive_failures, last_run_at, public_status, failing_since, succeeding_since)
     SELECT
       v.test_id,
       v.last_status,
       CASE WHEN v.last_status = 'success' OR v.last_status = 'warn' THEN 0
            ELSE COALESCE(ts.consecutive_failures, 0) + 1
       END,
       v.last_run_at,
       v.public_status,
       v.failing_since,
       v.succeeding_since
     FROM (VALUES ${placeholders.join(',')}) AS v(test_id, last_status, last_run_at, public_status, failing_since, succeeding_since)
     LEFT JOIN test_state ts ON ts.test_id = v.test_id
     ON CONFLICT (test_id) DO UPDATE SET
       last_status          = EXCLUDED.last_status,
       consecutive_failures = EXCLUDED.consecutive_failures,
       last_run_at          = EXCLUDED.last_run_at,
       public_status        = EXCLUDED.public_status,
       failing_since        = EXCLUDED.failing_since,
       succeeding_since     = EXCLUDED.succeeding_since`,
    values,
  )

  // Fire-and-forget notification checks (F-07) — fail/recovery now key off the same
  // public_status transition shown on the map/list, not a raw run status change.
  triggerNotifications(
    computed.map(c => ({
      test_id: c.result.test_id,
      new_status: c.result.status,
      prev_public_status: c.prevPublicStatus,
      new_public_status: c.public_status,
      error_message: c.result.error_message,
      duration_ms: c.result.duration_ms,
    })),
  )
}
