import Link from 'next/link'
import { INCIDENT_STATE_LABELS, formatDuration } from '@sentinel/shared'
import type { PublicIncident } from '@sentinel/shared'
import { plural } from '../../../lib/format'
import { severityKind } from '../../../lib/states'
import { StatusIndicator } from './status-indicator'
import { Visibility } from './incident-state'
import { Time } from './time-zone'

/**
 * A published incident on the public pages: severity, state, title, latest public update and
 * timing. Open ones take the tint of their severity; resolved ones are neutral.
 */
export function IncidentBanner({ incident, now }: { incident: PublicIncident; now: number }) {
  const open = incident.state !== 'resolved'
  const kind = open ? severityKind(incident.severity) : 'recovered'
  const latest = [...incident.updates].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const end = incident.resolved_at ? Date.parse(incident.resolved_at) : now
  const duration = formatDuration(end - Date.parse(incident.started_at))
  return (
    <Link className={`sn-incident${open ? ` sn-incident--${kind}` : ''}`} href={`/status/incidents/${incident.id}`}>
      <div className="sn-row">
        <StatusIndicator kind={kind} chip label={open ? undefined : 'Resolved'} />
        <Visibility published>{INCIDENT_STATE_LABELS[incident.state]}</Visibility>
      </div>
      <h2 className="sn-incident__title">{incident.title}</h2>
      {open && latest && <p className="sn-incident__update">{latest.body}</p>}
      <div className="sn-incident__meta">
        <span>
          {open ? 'Started ' : ''}
          <Time iso={incident.started_at} /> · {open ? duration : `lasted ${duration}`}
        </span>
        <span>{plural(incident.tests.length, 'check')} affected</span>
        {open && latest ? (
          <span>
            Updated <Time iso={latest.created_at} />
          </span>
        ) : incident.report ? (
          <span>Report published</span>
        ) : null}
      </div>
    </Link>
  )
}
