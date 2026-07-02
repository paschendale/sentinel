import pLimit from 'p-limit'
import type { Test } from '@sentinel/shared'
import { pool } from '../db/pool.js'
import { runTest } from '../executor/run.js'
import { enqueue } from '../db/result-buffer.js'
import { testEvents } from '../events.js'
import { logger } from '../logger.js'

const schedLog = logger.child({ component: 'scheduler' })

const CONCURRENCY = 10
const limit = pLimit(CONCURRENCY)
const timers = new Map<string, ReturnType<typeof setInterval>>()
// Per-test guard: prevents two overlapping scheduler-triggered runs of the SAME test.
// The global `limit` above only caps total concurrency across all tests combined — it
// does nothing to stop a single slow test from piling up on itself once timeout_ms can
// approach schedule_ms (see docs/DOMAINS.md timeout/schedule margin invariant).
const runningTestIds = new Set<string>()

function runScheduled(test: Test, context: string): void {
  if (runningTestIds.has(test.id)) {
    schedLog.warn({ test_id: test.id }, `scheduler: previous run still in flight, skipping test_id=${test.id} (${context})`)
    return
  }
  runningTestIds.add(test.id)
  limit(() => runTest(test, { trigger: 'scheduler' }).then(enqueue))
    .catch((err: unknown) => {
      schedLog.error({ test_id: test.id, err }, `scheduler: ${context} run failed for test_id=${test.id}`)
    })
    .finally(() => {
      runningTestIds.delete(test.id)
    })
}

function register(test: Test): void {
  unregister(test.id)
  if (!test.enabled) return

  const jitteredInterval = test.schedule_ms + Math.random() * test.schedule_ms * 0.1

  const timer = setInterval(() => {
    if (limit.activeCount >= CONCURRENCY) {
      schedLog.warn({ test_id: test.id }, `scheduler: queue full, skipping test_id=${test.id}`)
      return
    }
    runScheduled(test, 'scheduled')
  }, jitteredInterval)

  timers.set(test.id, timer)
}

function unregister(testId: string): void {
  const timer = timers.get(testId)
  if (timer !== undefined) {
    clearInterval(timer)
    timers.delete(testId)
  }
}

export async function startScheduler(): Promise<void> {
  const { rows } = await pool.query<Test>('SELECT * FROM tests WHERE enabled = true')
  for (const test of rows) {
    register(test)
  }

  testEvents.on('test:created', (test: Test) => {
    register(test)
    if (test.enabled) {
      runScheduled(test, 'immediate run after create')
    }
  })
  testEvents.on('test:updated', (test: Test) => {
    unregister(test.id)
    if (test.enabled) register(test)
  })
  testEvents.on('test:deleted', (testId: string) => unregister(testId))

  schedLog.info({ test_count: rows.length }, `scheduler started: ${rows.length} enabled test(s)`)
}

export function stopScheduler(): void {
  for (const timer of timers.values()) {
    clearInterval(timer)
  }
  timers.clear()
}
