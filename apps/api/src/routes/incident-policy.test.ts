import { describe, expect, it } from 'vitest'
import { buildIncidentsFromRuns, mergeStoredIncidents } from './incident-policy.js'

function mkRun(ts: string, status: 'success' | 'fail' | 'timeout') {
  const startedAt = new Date(ts)
  const finishedAt = new Date(startedAt.getTime() + 1_000)
  return { started_at: startedAt, finished_at: finishedAt, status }
}

describe('buildIncidentsFromRuns', () => {
  it('opens incident only after threshold and closes on success', () => {
    const runs = [
      mkRun('2026-04-01T12:00:00.000Z', 'success'),
      mkRun('2026-04-01T12:01:00.000Z', 'fail'),
      mkRun('2026-04-01T12:02:00.000Z', 'timeout'),
      mkRun('2026-04-01T12:03:00.000Z', 'fail'),
      mkRun('2026-04-01T12:04:00.000Z', 'fail'),
      mkRun('2026-04-01T12:05:00.000Z', 'success'),
    ]

    const incidents = buildIncidentsFromRuns(runs, 3)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({
      started_at: '2026-04-01T12:01:00.000Z',
      ended_at: '2026-04-01T12:05:01.000Z',
      failure_count: 4,
      ongoing: false,
    })
  })

  it('does not create incidents for intermittent failures below threshold', () => {
    const runs = [
      mkRun('2026-04-01T12:00:00.000Z', 'success'),
      mkRun('2026-04-01T12:01:00.000Z', 'fail'),
      mkRun('2026-04-01T12:02:00.000Z', 'success'),
      mkRun('2026-04-01T12:03:00.000Z', 'timeout'),
      mkRun('2026-04-01T12:04:00.000Z', 'success'),
    ]

    const incidents = buildIncidentsFromRuns(runs, 3)
    expect(incidents).toEqual([])
  })

  it('marks incident as ongoing when no recovery success happened yet', () => {
    const runs = [
      mkRun('2026-04-01T12:00:00.000Z', 'fail'),
      mkRun('2026-04-01T12:01:00.000Z', 'timeout'),
      mkRun('2026-04-01T12:02:00.000Z', 'fail'),
    ]

    const incidents = buildIncidentsFromRuns(runs, 2)
    expect(incidents).toHaveLength(1)
    expect(incidents[0]).toMatchObject({
      started_at: '2026-04-01T12:00:00.000Z',
      ended_at: '2026-04-01T12:02:01.000Z',
      failure_count: 3,
      ongoing: true,
    })
  })
})

describe('mergeStoredIncidents', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h))
  const derived = [{ started_at: at(10).toISOString(), ended_at: at(11).toISOString(), duration_ms: 3_600_000, failure_count: 4, ongoing: false }]

  it('keeps derived incidents and adds stored ones older than the retained runs, newest first', () => {
    const merged = mergeStoredIncidents(derived, [
      { started_at: at(10), ended_at: at(11), failed_runs: 9 }, // same window: derived wins
      { started_at: at(1), ended_at: at(2), failed_runs: 6 },
    ])
    expect(merged).toEqual([
      derived[0],
      { started_at: at(1).toISOString(), ended_at: at(2).toISOString(), duration_ms: 3_600_000, failure_count: 6, ongoing: false },
    ])
  })

  it('marks a stored incident without an end as ongoing', () => {
    const [only] = mergeStoredIncidents([], [{ started_at: at(1), ended_at: null, failed_runs: null }], at(3))
    expect(only).toMatchObject({ ongoing: true, duration_ms: 2 * 3_600_000, failure_count: 0 })
  })
})
