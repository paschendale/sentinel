import pLimit from 'p-limit'
import type { Test } from '@sentinel/shared'
import { pool } from '../db/pool.js'
import { runTestWithRetries } from '../executor/run.js'
import { enqueue } from '../db/result-buffer.js'
import { testEvents } from '../events.js'
import { logger } from '../logger.js'
import { releaseRun, tryClaimRun } from './run-guard.js'

const schedLog = logger.child({ component: 'scheduler' })

const CONCURRENCY = 10
const limit = pLimit(CONCURRENCY)
const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** Bumped on every create/update/delete of a test, so a late async re-register cannot revive a stale schedule. */
const generations = new Map<string, number>()

function nextGeneration(testId: string): number {
  const gen = (generations.get(testId) ?? 0) + 1
  generations.set(testId, gen)
  return gen
}

/** Tests overdue at startup start within this window, spread out so they do not all fire at once. */
export const OVERDUE_SPREAD_MS = 60_000

/**
 * Delay before a test's first scheduled run after (re)registering it: the time left until
 * `last_run_at + schedule_ms`, so a restart or an edit keeps the test's phase instead of
 * pushing the next run a full interval out. Never-run and overdue tests start within
 * OVERDUE_SPREAD_MS (or the interval, if shorter).
 */
export function firstDelayMs(scheduleMs: number, lastRunAt: Date | null, now: number, random: () => number = Math.random): number {
  const spread = Math.min(scheduleMs, OVERDUE_SPREAD_MS)
  if (lastRunAt === null) return Math.floor(random() * spread)
  const due = lastRunAt.getTime() + scheduleMs - now
  if (due <= 0) return Math.floor(random() * spread)
  return Math.min(due, scheduleMs)
}

function runScheduled(test: Test, context: string): void {
  if (!tryClaimRun(test.id)) {
    schedLog.warn({ test_id: test.id }, `scheduler: previous run still in flight, skipping test_id=${test.id} (${context})`)
    return
  }
  limit(() => runTestWithRetries(test, { trigger: 'scheduler' }).then(enqueue))
    .catch((err: unknown) => {
      schedLog.error({ test_id: test.id, err }, `scheduler: ${context} run failed for test_id=${test.id}`)
    })
    .finally(() => {
      releaseRun(test.id)
    })
}

function tick(test: Test): void {
  if (limit.activeCount >= CONCURRENCY) {
    schedLog.warn({ test_id: test.id }, `scheduler: queue full, skipping test_id=${test.id}`)
    return
  }
  runScheduled(test, 'scheduled')
}

function register(test: Test, lastRunAt: Date | null): void {
  unregister(test.id)
  if (!test.enabled) return

  // A little jitter so tests with the same interval drift apart.
  const interval = test.schedule_ms + Math.random() * test.schedule_ms * 0.1
  const schedule = (delay: number): void => {
    const timer = setTimeout(() => {
      if (timers.get(test.id) !== timer) return
      schedule(interval)
      tick(test)
    }, delay)
    timers.set(test.id, timer)
  }
  schedule(firstDelayMs(test.schedule_ms, lastRunAt, Date.now()))
}

function unregister(testId: string): void {
  const timer = timers.get(testId)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(testId)
  }
}

async function lastRunAtOf(testId: string): Promise<Date | null> {
  const { rows } = await pool.query<{ last_run_at: Date | null }>('SELECT last_run_at FROM test_state WHERE test_id = $1', [testId])
  return rows[0]?.last_run_at ?? null
}

export async function startScheduler(): Promise<void> {
  const { rows } = await pool.query<Test & { last_run_at: Date | null }>(
    `SELECT t.*, ts.last_run_at FROM tests t LEFT JOIN test_state ts ON ts.test_id = t.id WHERE t.enabled = true`,
  )
  for (const { last_run_at, ...test } of rows) {
    register(test, last_run_at)
  }

  testEvents.on('test:created', (test: Test) => {
    nextGeneration(test.id)
    // The immediate run below is the first one; the next follows one interval later.
    register(test, new Date())
    if (test.enabled) {
      runScheduled(test, 'immediate run after create')
    }
  })
  testEvents.on('test:updated', (test: Test) => {
    const gen = nextGeneration(test.id)
    unregister(test.id)
    if (!test.enabled) return
    lastRunAtOf(test.id)
      .then((lastRunAt) => {
        if (generations.get(test.id) === gen) register(test, lastRunAt)
      })
      .catch((err: unknown) => {
        schedLog.error({ test_id: test.id, err }, `scheduler: could not read last run of test_id=${test.id}, using a full interval`)
        if (generations.get(test.id) === gen) register(test, new Date())
      })
  })
  testEvents.on('test:deleted', (testId: string) => {
    nextGeneration(testId)
    unregister(testId)
  })

  schedLog.info({ test_count: rows.length }, `scheduler started: ${rows.length} enabled test(s)`)
}

export function stopScheduler(): void {
  for (const timer of timers.values()) {
    clearTimeout(timer)
  }
  timers.clear()
}
