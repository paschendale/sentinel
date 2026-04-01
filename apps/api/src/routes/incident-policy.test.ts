import { describe, expect, it } from 'vitest'
import { buildIncidentsFromRuns } from './incident-policy.js'

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
