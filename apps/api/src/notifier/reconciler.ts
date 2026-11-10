import { getThreadsToReconcile } from '../db/queries/incident-threads.js'
import { logger } from '../logger.js'
import { closeOpenIncidents } from './incidents.js'

const log = logger.child({ component: 'reconciler' })

/** How often the reconciler runs. */
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000
/** A test must have been Operational this long before the reconciler steps in. */
export const RECONCILE_SETTLED_MS = 2 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/**
 * Closes bot-channel threads left open after their test recovered (a failed close on the
 * provider side, a restart mid-delivery). Never throws.
 */
export async function reconcileThreads(): Promise<number> {
  let closed = 0
  try {
    const threads = await getThreadsToReconcile(RECONCILE_SETTLED_MS)
    for (const thread of threads) {
      await closeOpenIncidents(
        {
          testId: thread.test_id,
          consecutiveFailures: 0,
          failureThreshold: 0,
          cooldownMs: 0,
          info: {
            testName: thread.test_name,
            consecutiveFailures: 0,
            errorMessage: null,
            durationMs: thread.last_duration_ms ?? 0,
            downtimeMs: null,
          },
        },
        [thread],
      )
      closed += 1
    }
    if (closed > 0) log.info({ event: 'reconciler.threads_closed', count: closed }, `reconciler: retried closing ${closed} thread(s)`)
  } catch (err) {
    log.error({ event: 'reconciler.failed', err }, 'reconciler: thread pass failed')
  }
  return closed
}

export async function reconcileOnce(): Promise<void> {
  if (running) return
  running = true
  try {
    await reconcileThreads()
  } finally {
    running = false
  }
}

export function startReconciler(): void {
  if (timer !== null) return
  timer = setInterval(() => { void reconcileOnce() }, RECONCILE_INTERVAL_MS)
  timer.unref()
}

export function stopReconciler(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}
