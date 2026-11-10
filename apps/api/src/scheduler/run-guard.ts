/**
 * Per-test overlap guard shared by the scheduler and run-now: at most one run of a test is in
 * flight at a time, whoever started it. The scheduler's concurrency limit only caps runs across
 * all tests; it does nothing to stop one slow test from piling up on itself (see the
 * timeout/schedule margin in docs/DOMAINS.md).
 */
const running = new Set<string>()

/** Claims the test; false when a run of it is already in flight. */
export function tryClaimRun(testId: string): boolean {
  if (running.has(testId)) return false
  running.add(testId)
  return true
}

export function releaseRun(testId: string): void {
  running.delete(testId)
}

export function isRunning(testId: string): boolean {
  return running.has(testId)
}
