import { describe, expect, it } from 'vitest'
import type { TestStatus } from '@sentinel/shared'
import { computePublicStatus, type PublicStatusPrevState } from './public-status.js'

const WINDOW_MS = 60 * 60 * 1000 // 1h, matches the default PUBLIC_STATUS_WINDOW_MS

const NEVER_RUN: PublicStatusPrevState = { public_status: null, failing_since: null, succeeding_since: null }
const STABLE_UP: PublicStatusPrevState = { public_status: 'up', failing_since: null, succeeding_since: null }

const t = (iso: string) => new Date(iso)

describe('computePublicStatus', () => {
  it('a brand new test is "up" on its first success, with no proving period', () => {
    const r = computePublicStatus(NEVER_RUN, 'success', t('2026-01-01T00:00:00Z'), WINDOW_MS)
    expect(r).toEqual({ public_status: 'up', failing_since: null, succeeding_since: null })
  })

  it('a stable up test stays up on further successes (no re-proving)', () => {
    const r = computePublicStatus(STABLE_UP, 'success', t('2026-01-01T00:00:00Z'), WINDOW_MS)
    expect(r).toEqual({ public_status: 'up', failing_since: null, succeeding_since: null })
  })

  it('the first failure after being up is "degraded", not "down"', () => {
    const r = computePublicStatus(STABLE_UP, 'fail', t('2026-01-01T00:00:00Z'), WINDOW_MS)
    expect(r.public_status).toBe('degraded')
    expect(r.failing_since).toEqual(t('2026-01-01T00:00:00Z'))
  })

  it('stays "degraded" while the failure streak is under the window', () => {
    const midStreak: PublicStatusPrevState = { public_status: 'degraded', failing_since: t('2026-01-01T00:00:00Z'), succeeding_since: null }
    const r = computePublicStatus(midStreak, 'fail', t('2026-01-01T00:30:00Z'), WINDOW_MS)
    expect(r.public_status).toBe('degraded')
    expect(r.failing_since).toEqual(t('2026-01-01T00:00:00Z')) // streak start preserved
  })

  it('flips to "down" once the failure streak reaches the window', () => {
    const midStreak: PublicStatusPrevState = { public_status: 'degraded', failing_since: t('2026-01-01T00:00:00Z'), succeeding_since: null }
    const r = computePublicStatus(midStreak, 'fail', t('2026-01-01T01:00:00Z'), WINDOW_MS)
    expect(r.public_status).toBe('down')
    expect(r.failing_since).toEqual(t('2026-01-01T00:00:00Z'))
  })

  it('stays "down" on continued failures past the window', () => {
    const down: PublicStatusPrevState = { public_status: 'down', failing_since: t('2026-01-01T00:00:00Z'), succeeding_since: null }
    const r = computePublicStatus(down, 'fail', t('2026-01-01T02:00:00Z'), WINDOW_MS)
    expect(r.public_status).toBe('down')
  })

  it('a single success after "down" moves to "degraded" (recovering), not straight to "up"', () => {
    const down: PublicStatusPrevState = { public_status: 'down', failing_since: t('2026-01-01T00:00:00Z'), succeeding_since: null }
    const r = computePublicStatus(down, 'success', t('2026-01-01T02:00:00Z'), WINDOW_MS)
    expect(r.public_status).toBe('degraded')
    expect(r.failing_since).toBeNull()
    expect(r.succeeding_since).toEqual(t('2026-01-01T02:00:00Z'))
  })

  it('flips to "up" once the recovery streak reaches the window', () => {
    const recovering: PublicStatusPrevState = { public_status: 'degraded', failing_since: null, succeeding_since: t('2026-01-01T02:00:00Z') }
    const r = computePublicStatus(recovering, 'success', t('2026-01-01T03:00:00Z'), WINDOW_MS)
    expect(r).toEqual({ public_status: 'up', failing_since: null, succeeding_since: null })
  })

  it('a failure during recovery resets the recovery clock entirely', () => {
    const recovering: PublicStatusPrevState = { public_status: 'degraded', failing_since: null, succeeding_since: t('2026-01-01T02:00:00Z') }
    const r = computePublicStatus(recovering, 'fail', t('2026-01-01T02:45:00Z'), WINDOW_MS)
    expect(r.public_status).toBe('degraded')
    expect(r.succeeding_since).toBeNull()
    expect(r.failing_since).toEqual(t('2026-01-01T02:45:00Z')) // a fresh failure streak, not the old recovery start
  })

  it('flapping (fail/success/fail/success within the window) never settles on "up" or "down"', () => {
    let state: PublicStatusPrevState = STABLE_UP
    const times = ['00:00', '00:10', '00:20', '00:30', '00:40'].map(m => t(`2026-01-01T${m}:00Z`))
    const statuses: TestStatus[] = ['fail', 'success', 'fail', 'success', 'fail']
    for (let i = 0; i < times.length; i++) {
      const r = computePublicStatus(state, statuses[i]!, times[i]!, WINDOW_MS)
      expect(r.public_status).toBe('degraded')
      state = r
    }
  })

  it('a "warn" result is always "degraded" and does not touch the failure streak', () => {
    const failing: PublicStatusPrevState = { public_status: 'degraded', failing_since: t('2026-01-01T00:00:00Z'), succeeding_since: null }
    const r = computePublicStatus(failing, 'warn', t('2026-01-01T00:10:00Z'), WINDOW_MS)
    expect(r.public_status).toBe('degraded')
    expect(r.failing_since).toBeNull()
  })

  it('a "warn" result preserves an in-progress recovery streak untouched', () => {
    const recovering: PublicStatusPrevState = { public_status: 'degraded', failing_since: null, succeeding_since: t('2026-01-01T00:00:00Z') }
    const r = computePublicStatus(recovering, 'warn', t('2026-01-01T00:10:00Z'), WINDOW_MS)
    expect(r.succeeding_since).toEqual(t('2026-01-01T00:00:00Z'))
  })

  it('timeout is treated exactly like fail', () => {
    const r = computePublicStatus(STABLE_UP, 'timeout', t('2026-01-01T00:00:00Z'), WINDOW_MS)
    expect(r.public_status).toBe('degraded')
    expect(r.failing_since).toEqual(t('2026-01-01T00:00:00Z'))
  })
})
