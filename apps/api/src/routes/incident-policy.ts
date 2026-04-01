import type { Incident, TestStatus } from '@sentinel/shared'

interface IncidentRun {
  started_at: Date
  finished_at: Date
  status: TestStatus
}

interface OpenIncident {
  started_at: Date
  ended_at: Date
  failure_count: number
}

export function buildIncidentsFromRuns(
  runs: IncidentRun[],
  failureThreshold: number,
): Incident[] {
  const threshold = Math.max(1, failureThreshold)
  const incidents: Incident[] = []

  let consecutiveFailures = 0
  let streakStart: Date | null = null
  let openIncident: OpenIncident | null = null

  for (const run of runs) {
    if (run.status !== 'success') {
      if (consecutiveFailures === 0) {
        streakStart = run.started_at
      }
      consecutiveFailures += 1

      if (consecutiveFailures >= threshold) {
        if (openIncident === null) {
          openIncident = {
            started_at: streakStart ?? run.started_at,
            ended_at: run.finished_at,
            failure_count: consecutiveFailures,
          }
        } else {
          openIncident.ended_at = run.finished_at
          openIncident.failure_count += 1
        }
      }
      continue
    }

    if (openIncident !== null) {
      const closedAt = run.finished_at
      incidents.push({
        started_at: openIncident.started_at.toISOString(),
        ended_at: closedAt.toISOString(),
        duration_ms: closedAt.getTime() - openIncident.started_at.getTime(),
        failure_count: openIncident.failure_count,
        ongoing: false,
      })
      openIncident = null
    }

    consecutiveFailures = 0
    streakStart = null
  }

  if (openIncident !== null) {
    incidents.push({
      started_at: openIncident.started_at.toISOString(),
      ended_at: openIncident.ended_at.toISOString(),
      duration_ms: openIncident.ended_at.getTime() - openIncident.started_at.getTime(),
      failure_count: openIncident.failure_count,
      ongoing: true,
    })
  }

  incidents.reverse()
  return incidents
}
