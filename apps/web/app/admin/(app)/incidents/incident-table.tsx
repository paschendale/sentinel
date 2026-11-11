import Link from 'next/link'
import { INCIDENT_STATE_LABELS, formatDuration } from '@sentinel/shared'
import type { IncidentListItem } from '@sentinel/shared'
import { dateTime, plural } from '../../../../lib/format'
import { severityKind } from '../../../../lib/states'
import { StatusIndicator, Visibility } from '../../../_components/ui'

export function incidentDuration(i: Pick<IncidentListItem, 'started_at' | 'resolved_at' | 'duration_ms'>, now: number): string {
  if (i.duration_ms !== null) return formatDuration(i.duration_ms)
  return formatDuration((i.resolved_at ? Date.parse(i.resolved_at) : now) - Date.parse(i.started_at))
}

/** Incidents as rows: title and test count, severity, state, start, duration, who can see it. */
export function IncidentTable({ incidents, now }: { incidents: IncidentListItem[]; now: number }) {
  return (
    <div className="sn-table-wrap">
      <table className="sn-table" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th>Incident</th>
            <th style={{ width: 120 }}>Severity</th>
            <th style={{ width: 130 }}>State</th>
            <th style={{ width: 170 }}>Started</th>
            <th style={{ width: 120 }}>Duration</th>
            <th style={{ width: 190 }}>Visibility</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => {
            const resolved = i.state === 'resolved'
            return (
              <tr key={i.id}>
                <td>
                  <Link className="sn-table__name" href={`/admin/incidents/${i.id}`}>
                    {i.title}
                  </Link>
                  <span className="sn-table__sub">{plural(i.tests.length, 'test')}</span>
                </td>
                <td>
                  <StatusIndicator kind={resolved ? 'recovered' : severityKind(i.severity)} label={resolved ? 'Resolved' : undefined} chip />
                </td>
                <td>{INCIDENT_STATE_LABELS[i.state]}</td>
                <td suppressHydrationWarning>
                  {dateTime(i.started_at, 'utc', new Date(now))}
                </td>
                <td>{incidentDuration(i, now)}</td>
                <td>
                  <span className="sn-row" style={{ gap: 4 }}>
                    <Visibility published={i.published_at !== null} />
                    {i.report_state === 'published' ? <Visibility published>Report</Visibility> : i.report_state === 'draft' ? <Visibility published={false}>Draft report</Visibility> : null}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
