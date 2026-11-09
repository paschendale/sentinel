import { describe, expect, it } from 'vitest'
import {
  RECOVERY_WINDOW_MS,
  STATUS_SECTIONS,
  compareInSection,
  formatDuration,
  sinceText,
  statusSection,
  type ProblemWindow,
  type StatusSection,
} from '@sentinel/shared'

const NOW = new Date('2026-11-09T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const H = 3_600_000
const M = 60_000

describe('statusSection', () => {
  it('puts a disabled test in disabled whatever its state', () => {
    expect(statusSection({ enabled: false, public_status: 'down', last_problem_at: ago(M) }, NOW)).toBe('disabled')
  })

  it('maps down to critical and degraded to warning', () => {
    expect(statusSection({ enabled: true, public_status: 'down', last_problem_at: ago(M) }, NOW)).toBe('critical')
    expect(statusSection({ enabled: true, public_status: 'degraded', last_problem_at: ago(M) }, NOW)).toBe('warning')
  })

  it('keeps a passing test in recovered for 24 h after its last problem, then clean', () => {
    expect(statusSection({ enabled: true, public_status: 'up', last_problem_at: ago(RECOVERY_WINDOW_MS - M) }, NOW)).toBe('recovered')
    expect(statusSection({ enabled: true, public_status: 'up', last_problem_at: ago(RECOVERY_WINDOW_MS) }, NOW)).toBe('clean')
    expect(statusSection({ enabled: true, public_status: 'up', last_problem_at: null }, NOW)).toBe('clean')
  })

  it('treats an unknown state (never run) as clean and ignores a problem time in the future', () => {
    expect(statusSection({ enabled: true, public_status: 'unknown', last_problem_at: null }, NOW)).toBe('clean')
    expect(statusSection({ enabled: true, public_status: 'up', last_problem_at: new Date(NOW.getTime() + H).toISOString() }, NOW)).toBe('clean')
  })

  it('defaults now to the current time', () => {
    expect(statusSection({ enabled: true, public_status: 'up', last_problem_at: new Date().toISOString() })).toBe('recovered')
  })

  it('lists the sections top to bottom', () => {
    expect(STATUS_SECTIONS).toEqual(['critical', 'warning', 'recovered', 'clean', 'disabled'])
  })
})

const win = (over: Partial<ProblemWindow> & { name: string }): ProblemWindow & { name: string } => ({
  problem_started_at: null,
  problem_ended_at: null,
  problem_worst: null,
  last_problem_at: null,
  ...over,
})

describe('compareInSection', () => {
  const sort = (section: StatusSection, list: Array<ProblemWindow & { name: string }>) =>
    [...list].sort((a, b) => compareInSection(section, a, b)).map((x) => x.name)

  it('orders critical and warning by newest problem first, then by name', () => {
    const list = [
      win({ name: 'old', problem_started_at: ago(5 * H) }),
      win({ name: 'new', problem_started_at: ago(M) }),
      win({ name: 'b-same', problem_started_at: ago(H) }),
      win({ name: 'a-same', problem_started_at: ago(H) }),
    ]
    expect(sort('critical', list)).toEqual(['new', 'a-same', 'b-same', 'old'])
    expect(sort('warning', list)).toEqual(['new', 'a-same', 'b-same', 'old'])
  })

  it('orders recovered by most recent recovery, falling back to the last problem time', () => {
    const list = [
      win({ name: 'early', problem_ended_at: ago(10 * H) }),
      win({ name: 'late', problem_ended_at: ago(H) }),
      win({ name: 'backfilled', last_problem_at: ago(2 * H) }),
    ]
    expect(sort('recovered', list)).toEqual(['late', 'backfilled', 'early'])
  })

  it('orders clean and disabled alphabetically', () => {
    const list = [win({ name: 'b' }), win({ name: 'a' })]
    expect(sort('clean', list)).toEqual(['a', 'b'])
    expect(sort('disabled', list)).toEqual(['a', 'b'])
  })
})

describe('formatDuration', () => {
  it('formats minutes, hours and days', () => {
    expect(formatDuration(20_000)).toBe('under a minute')
    expect(formatDuration(-5 * M)).toBe('under a minute')
    expect(formatDuration(14 * M)).toBe('14m')
    expect(formatDuration(5 * H + 6 * M)).toBe('5h 06m')
    expect(formatDuration(26 * H + 30 * M)).toBe('1d 2h')
  })
})

describe('sinceText', () => {
  const base = { problem_started_at: null, problem_ended_at: null, problem_worst: null, last_problem_at: null }

  it('says how long a critical test has been failing and since when', () => {
    expect(sinceText({ ...base, section: 'critical', problem_started_at: ago(5 * H + 6 * M) }, NOW)).toEqual({
      text: 'failing for 5h 06m', sub: 'since 06:54 UTC', tone: 'critical',
    })
  })

  it('shows the date as well when the problem started more than 20 h ago', () => {
    expect(sinceText({ ...base, section: 'critical', problem_started_at: ago(30 * H) }, NOW).sub).toBe('since 2026-11-08 06:00 UTC')
  })

  it('falls back to a bare label without a start time', () => {
    expect(sinceText({ ...base, section: 'critical' }, NOW)).toEqual({ text: 'failing', sub: null, tone: 'critical' })
    expect(sinceText({ ...base, section: 'warning' }, NOW)).toEqual({ text: 'degraded', sub: null, tone: 'warning' })
    expect(sinceText({ ...base, section: 'recovered' }, NOW)).toEqual({ text: 'recovered', sub: null, tone: 'recovered' })
  })

  it('counts failing runs under the threshold when the admin view knows them', () => {
    expect(sinceText({ ...base, section: 'warning', failing: { count: 1, threshold: 3 } }, NOW)).toEqual({
      text: 'failing, 1 of 3 runs', sub: 'below the failure threshold', tone: 'warning',
    })
  })

  it('says how long a warning has lasted otherwise', () => {
    expect(sinceText({ ...base, section: 'warning', problem_started_at: ago(14 * M), failing: { count: 0, threshold: 3 } }, NOW).text).toBe('degraded for 14m')
  })

  it('says when a test recovered and how long the problem lasted', () => {
    const down = { ...base, section: 'recovered' as const, problem_started_at: ago(27 * H), problem_ended_at: ago(52 * M), problem_worst: 'down' as const }
    expect(sinceText(down, NOW)).toEqual({ text: 'recovered 52m ago', sub: 'was down for 1d 2h', tone: 'recovered' })
    expect(sinceText({ ...down, problem_worst: 'degraded' }, NOW).sub).toMatch(/^degraded for /)
  })

  it('uses the last problem time when no recovery time was recorded', () => {
    expect(sinceText({ ...base, section: 'recovered', last_problem_at: ago(2 * H) }, NOW)).toEqual({
      text: 'recovered 2h 00m ago', sub: null, tone: 'recovered',
    })
  })

  it('is muted for clean and disabled tests', () => {
    expect(sinceText({ ...base, section: 'clean' }, NOW)).toEqual({ text: '—', sub: null, tone: 'muted' })
    expect(sinceText({ ...base, section: 'disabled' }, NOW)).toEqual({ text: 'disabled', sub: null, tone: 'muted' })
  })
})
