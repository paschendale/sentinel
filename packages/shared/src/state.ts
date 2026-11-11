import type { NotificationEventType, PublicStatusOutcome, TestStatus } from './types.js'
import type { StatusSection } from './sections.js'

/**
 * One definition of what a run result means, used by the API (state upsert, buckets,
 * aggregation, derived incidents, notifier) and by the web app.
 *
 * - `success` passes.
 * - `warn` is not a failure: the run passed with a warning. The test is Degraded and its
 *   failure streak resets.
 * - `fail` and `timeout` are failures. They count toward the test's failure threshold; once
 *   the streak reaches it the test is in Outage, below it the test is Degraded.
 */
export const FAILURE_STATUSES: readonly TestStatus[] = ['fail', 'timeout']

export function isFailure(status: TestStatus): boolean {
  return status === 'fail' || status === 'timeout'
}

export function isPassing(status: TestStatus): boolean {
  return status === 'success'
}

/** Consecutive failures after a run, given the count before it. */
export function nextConsecutiveFailures(status: TestStatus, previous: number): number {
  return isFailure(status) ? previous + 1 : 0
}

/**
 * A test's state after a run. `consecutiveFailures` includes this run (see
 * nextConsecutiveFailures). The SQL upsert in `apps/api/src/db/result-buffer.ts` mirrors this.
 */
export function publicStatusFor(
  status: TestStatus,
  consecutiveFailures: number,
  failureThreshold: number,
): Exclude<PublicStatusOutcome, 'unknown'> {
  if (status === 'success') return 'up'
  if (isFailure(status) && consecutiveFailures >= Math.max(1, failureThreshold)) return 'down'
  return 'degraded'
}

/** Outcome of a period (a day, a bucket) from its run counts. */
export function periodOutcome(success: number, warn: number, failure: number): PublicStatusOutcome {
  if (failure > 0 && success === 0 && warn === 0) return 'down'
  if (failure > 0 || warn > 0) return 'degraded'
  if (success > 0) return 'up'
  return 'unknown'
}

/**
 * Share of runs that did not fail, in percent rounded to `digits` decimals (whole percent by
 * default); null without runs. Warned runs count as available. Never rounds up to 100 while a
 * run failed, so "100%" always means no failures.
 */
export function uptimePct(success: number, warn: number, failure: number, digits = 0): number | null {
  const total = success + warn + failure
  if (total === 0) return null
  const f = 10 ** digits
  const pct = Math.round((100 * f * (success + warn)) / total) / f
  return failure > 0 && pct >= 100 ? 100 - 1 / f : pct
}

/** Severity order of states, worst last. */
const SEVERITY: Record<PublicStatusOutcome, number> = { unknown: 0, up: 1, degraded: 2, down: 3 }

export function worseStatus<T extends PublicStatusOutcome>(a: T, b: T): T {
  return SEVERITY[b] > SEVERITY[a] ? b : a
}

/**
 * The pass/fail contract of a test function, stated once for the MCP text, the editor hint and
 * the docs. Enforced in apps/api/src/executor/run.ts.
 */
export const TEST_RESULT_CONTRACT =
  'Throw, fail a ctx.assert, or return false to fail the run; returning true, nothing or any other value passes. ctx.warn marks a passing run as Warned.'

// --- Words people read -------------------------------------------------------------------
// Wire values never change; these maps are the only place they turn into words.

/** A test's state. */
export const STATE_LABELS: Record<PublicStatusOutcome, string> = {
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Outage',
  unknown: 'No data',
}

/** A single run, in run history. */
export const RUN_RESULT_LABELS: Record<TestStatus, string> = {
  success: 'Passed',
  warn: 'Warned',
  fail: 'Failed',
  timeout: 'Timed out',
}

/** Where a test is listed. */
export const SECTION_LABELS: Record<StatusSection, string> = {
  critical: 'Outage',
  warning: 'Degraded',
  recovered: 'Recovered',
  clean: 'Operational',
  disabled: 'Paused',
}

/** A notification event type, as routing toggles and messages name it. */
export const EVENT_LABELS: Record<NotificationEventType, string> = {
  fail: 'Outage',
  warning: 'Degraded',
  recovery: 'Recovered',
}

export type IncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved'

export const INCIDENT_STATES: readonly IncidentState[] = ['investigating', 'identified', 'monitoring', 'resolved']

export const INCIDENT_STATE_LABELS: Record<IncidentState, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

/** Who can see an incident, a note or a report. */
export const VISIBILITY_LABELS = { internal: 'Internal', published: 'Published' } as const

// --- Formatting --------------------------------------------------------------------------

/** Durations as people read them: "45 s", "12 min", "2 h 27 min", "3 d 4 h". */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  if (totalSec < 60) return `${totalSec} s`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) return `${totalMin} min`
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours < 24) return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`
  const days = Math.floor(hours / 24)
  const restH = hours % 24
  return restH === 0 ? `${days} d` : `${days} d ${restH} h`
}

/** A timestamp from Postgres (Date) or JSON (string) as an ISO string; null stays null. */
export function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  return v instanceof Date ? v.toISOString() : String(v)
}
