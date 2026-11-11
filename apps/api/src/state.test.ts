import { describe, expect, it } from 'vitest'
import {
  EVENT_LABELS,
  RUN_RESULT_LABELS,
  SECTION_LABELS,
  STATE_LABELS,
  STATUS_SECTIONS,
  isFailure,
  isPassing,
  nextConsecutiveFailures,
  periodOutcome,
  publicStatusFor,
  toIso,
  uptimePct,
  worseStatus,
  type TestStatus,
} from '@sentinel/shared'
import { buildIncidentsFromRuns } from './routes/incident-policy.js'

describe('one definition of a run result', () => {
  it('counts only fail and timeout as failures', () => {
    expect((['success', 'warn', 'fail', 'timeout'] as TestStatus[]).map(isFailure)).toEqual([false, false, true, true])
    expect((['success', 'warn', 'fail', 'timeout'] as TestStatus[]).map(isPassing)).toEqual([true, false, false, false])
  })

  it('resets the failure streak on a pass or a warning', () => {
    expect(nextConsecutiveFailures('fail', 2)).toBe(3)
    expect(nextConsecutiveFailures('timeout', 0)).toBe(1)
    expect(nextConsecutiveFailures('warn', 4)).toBe(0)
    expect(nextConsecutiveFailures('success', 4)).toBe(0)
  })

  it('maps a run to Operational, Degraded or Outage', () => {
    expect(publicStatusFor('success', 0, 3)).toBe('up')
    expect(publicStatusFor('warn', 0, 3)).toBe('degraded')
    expect(publicStatusFor('fail', 2, 3)).toBe('degraded')
    expect(publicStatusFor('fail', 3, 3)).toBe('down')
    expect(publicStatusFor('timeout', 1, 1)).toBe('down')
    // a threshold below 1 behaves like 1
    expect(publicStatusFor('fail', 1, 0)).toBe('down')
  })

  it('applies the status window to Outage and to recovery', () => {
    const hour = 3_600_000
    const w = (previous: 'up' | 'degraded' | 'down' | 'unknown', failingForMs = 0, passingForMs = 0) =>
      ({ windowMs: hour, failingForMs, passingForMs, previous })
    // Outage needs the threshold and a full window of failing
    expect(publicStatusFor('fail', 12, 3, w('degraded', hour - 1))).toBe('degraded')
    expect(publicStatusFor('fail', 12, 3, w('degraded', hour))).toBe('down')
    expect(publicStatusFor('fail', 2, 3, w('degraded', 2 * hour))).toBe('degraded')
    // after trouble, Operational needs a full window of passing
    expect(publicStatusFor('success', 0, 3, w('down', 0, hour - 1))).toBe('degraded')
    expect(publicStatusFor('success', 0, 3, w('degraded', 0, hour))).toBe('up')
    // a test that was fine (or new) stays Operational
    expect(publicStatusFor('success', 0, 3, w('up'))).toBe('up')
    expect(publicStatusFor('success', 0, 3, w('unknown'))).toBe('up')
    expect(publicStatusFor('warn', 0, 3, w('up'))).toBe('degraded')
    // a window of 0 is the plain rule
    expect(publicStatusFor('fail', 3, 3, { ...w('degraded'), windowMs: 0 })).toBe('down')
    expect(publicStatusFor('success', 0, 3, { ...w('down'), windowMs: 0 })).toBe('up')
  })

  it('derives a period outcome from success, warn and failure counts', () => {
    expect(periodOutcome(0, 0, 0)).toBe('unknown')
    expect(periodOutcome(5, 0, 0)).toBe('up')
    expect(periodOutcome(0, 3, 0)).toBe('degraded')
    expect(periodOutcome(4, 0, 1)).toBe('degraded')
    expect(periodOutcome(0, 1, 2)).toBe('degraded')
    expect(periodOutcome(0, 0, 2)).toBe('down')
  })

  it('counts warned runs as available in uptime', () => {
    expect(uptimePct(0, 0, 0)).toBeNull()
    expect(uptimePct(9, 1, 0)).toBe(100)
    expect(uptimePct(1, 0, 3)).toBe(25)
  })

  it('rounds uptime to the requested decimals and never shows 100 with a failure', () => {
    expect(uptimePct(964, 0, 36, 1)).toBe(96.4)
    expect(uptimePct(999, 0, 1)).toBe(99)
    expect(uptimePct(9999, 0, 1, 1)).toBe(99.9)
    expect(uptimePct(10, 0, 0, 1)).toBe(100)
  })

  it('orders states by severity', () => {
    expect(worseStatus('degraded', 'down')).toBe('down')
    expect(worseStatus('down', 'degraded')).toBe('down')
    expect(worseStatus('up', 'degraded')).toBe('degraded')
  })

  it('normalises timestamps', () => {
    expect(toIso(null)).toBeNull()
    expect(toIso(undefined)).toBeNull()
    expect(toIso(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z')
    expect(toIso('2026-01-02T03:04:05Z')).toBe('2026-01-02T03:04:05Z')
  })
})

describe('labels', () => {
  it('uses the brand vocabulary', () => {
    expect(STATE_LABELS).toEqual({ up: 'Operational', degraded: 'Degraded', down: 'Outage', unknown: 'No data' })
    expect(RUN_RESULT_LABELS).toEqual({ success: 'Passed', warn: 'Warned', fail: 'Failed', timeout: 'Timed out' })
    expect(EVENT_LABELS).toEqual({ fail: 'Outage', warning: 'Degraded', recovery: 'Recovered' })
  })

  it('labels every section', () => {
    for (const s of STATUS_SECTIONS) expect(SECTION_LABELS[s]).toMatch(/^[A-Z]/)
    expect(SECTION_LABELS.disabled).toBe('Paused')
  })
})

describe('derived incidents follow the same definition', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 0, min))
  const run = (min: number, status: TestStatus) => ({ started_at: t(min), finished_at: t(min), status })

  it('does not count warnings toward the threshold', () => {
    const runs = [run(0, 'fail'), run(1, 'warn'), run(2, 'fail'), run(3, 'warn'), run(4, 'success')]
    expect(buildIncidentsFromRuns(runs, 2)).toEqual([])
  })

  it('keeps an incident open through a warning and ends it on a pass', () => {
    const runs = [run(0, 'fail'), run(1, 'fail'), run(2, 'warn'), run(3, 'success')]
    const [incident] = buildIncidentsFromRuns(runs, 2)
    expect(incident).toMatchObject({ ongoing: false, failure_count: 2, started_at: t(0).toISOString(), ended_at: t(3).toISOString() })
  })
})
