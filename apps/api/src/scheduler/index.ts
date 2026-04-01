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

function register(test: Test): void {
  unregister(test.id)
  if (!test.enabled) return

  const jitteredInterval = test.schedule_ms + Math.random() * test.schedule_ms * 0.1

  const timer = setInterval(() => {
    if (limit.activeCount >= CONCURRENCY) {
      schedLog.warn({ test_id: test.id }, `scheduler: queue full, skipping test_id=${test.id}`)
      return
    }
    limit(() => runTest(test, { trigger: 'scheduler' }).then(enqueue)).catch((err: unknown) => {
      schedLog.error({ test_id: test.id, err }, `scheduler: scheduled run failed for test_id=${test.id}`)
    })
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
      limit(() => runTest(test, { trigger: 'scheduler' }).then(enqueue)).catch((err: unknown) => {
        schedLog.error({ test_id: test.id, err }, `scheduler: immediate run after create failed for test_id=${test.id}`)
      })
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
