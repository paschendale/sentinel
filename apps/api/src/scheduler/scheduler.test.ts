import { describe, expect, it } from 'vitest'
import { OVERDUE_SPREAD_MS, firstDelayMs } from './index.js'
import { isRunning, releaseRun, tryClaimRun } from './run-guard.js'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 0, 1, 12, 0)

describe('firstDelayMs', () => {
  it('keeps the phase: a 1 h test that ran 50 min ago runs in 10 min, not in an hour', () => {
    expect(firstDelayMs(HOUR, new Date(NOW - 50 * 60_000), NOW)).toBe(10 * 60_000)
  })

  it('starts an overdue test within the spread window', () => {
    expect(firstDelayMs(HOUR, new Date(NOW - 3 * HOUR), NOW, () => 0.5)).toBe(OVERDUE_SPREAD_MS / 2)
  })

  it('starts a never-run test within the spread window', () => {
    expect(firstDelayMs(HOUR, null, NOW, () => 0.999)).toBeLessThan(OVERDUE_SPREAD_MS)
  })

  it('never waits longer than one interval, even with a clock skew', () => {
    expect(firstDelayMs(HOUR, new Date(NOW + 5 * HOUR), NOW)).toBe(HOUR)
  })

  it('spreads short intervals over the interval itself', () => {
    expect(firstDelayMs(30_000, null, NOW, () => 0.999)).toBeLessThan(30_000)
  })
})

describe('run guard', () => {
  it('allows one run per test at a time', () => {
    expect(tryClaimRun('t')).toBe(true)
    expect(tryClaimRun('t')).toBe(false)
    expect(isRunning('t')).toBe(true)
    releaseRun('t')
    expect(tryClaimRun('t')).toBe(true)
    releaseRun('t')
  })
})
