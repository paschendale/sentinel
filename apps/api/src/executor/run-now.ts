import { getTestById } from '../db/queries/tests.js'
import { enqueue } from '../db/result-buffer.js'
import { releaseRun, tryClaimRun } from '../scheduler/run-guard.js'
import { runTest, type RunResult, type RunTrigger } from './run.js'

export type RunNowOutcome =
  | { kind: 'ok'; result: RunResult }
  | { kind: 'not_found' }
  | { kind: 'disabled' }
  | { kind: 'busy' }

/** Error text for every outcome but 'ok', shared by the REST routes and the MCP tool. */
export const RUN_NOW_ERRORS = {
  not_found: { status: 404, error: 'not found' },
  disabled: { status: 422, error: 'test is disabled' },
  busy: { status: 409, error: 'a run of this test is already in progress' },
} as const

/**
 * Runs a test once, now, and records the result like a scheduled run. One attempt (no
 * retries). Refuses while another run of the same test is in flight, whoever started it.
 */
export async function runNow(
  testId: string,
  options: { trigger: Exclude<RunTrigger, 'scheduler'>; onLog?: (message: string) => void },
): Promise<RunNowOutcome> {
  const test = await getTestById(testId)
  if (test === null) return { kind: 'not_found' }
  if (!test.enabled) return { kind: 'disabled' }
  if (!tryClaimRun(test.id)) return { kind: 'busy' }
  try {
    const result = await runTest(test, { trigger: options.trigger, ...(options.onLog ? { onLog: options.onLog } : {}) })
    enqueue(result)
    return { kind: 'ok', result }
  } finally {
    releaseRun(test.id)
  }
}
