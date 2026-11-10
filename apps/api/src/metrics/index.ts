import { register, Histogram, Counter } from 'prom-client'
import type { TestStatus } from '@sentinel/shared'
import { isFailure } from '@sentinel/shared'

export const checkDurationMs = new Histogram({
  name: 'sentinel_check_duration_ms',
  help: 'Test execution duration in milliseconds',
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
})

export const checkFailuresTotal = new Counter({
  name: 'sentinel_check_failures_total',
  help: 'Total number of failed or timed-out test executions',
})

export const checkSuccessTotal = new Counter({
  name: 'sentinel_check_success_total',
  help: 'Total number of successful test executions',
})

export const checkWarningsTotal = new Counter({
  name: 'sentinel_check_warnings_total',
  help: 'Total number of test executions that passed with a warning',
})

export function recordTestResult(status: TestStatus, duration_ms: number): void {
  checkDurationMs.observe(duration_ms)
  if (isFailure(status)) checkFailuresTotal.inc()
  else if (status === 'warn') checkWarningsTotal.inc()
  else checkSuccessTotal.inc()
}

export { register }
