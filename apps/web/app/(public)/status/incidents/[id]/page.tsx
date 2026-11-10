import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { INCIDENT_STATE_LABELS, formatDuration } from '@sentinel/shared'
import type { PublicIncident } from '@sentinel/shared'
import { apiGet } from '../../../../../lib/api-server'
import { PUBLIC_REVALIDATE } from '../../../../../lib/site'
import { severityKind } from '../../../../../lib/states'
import { ApiErrorCallout, BackLink, IncidentReport, IncidentTimeline, PublicHeader, StatusIndicator, Time, Visibility } from '../../../../_components/ui'

export const dynamic = 'force-dynamic'

async function load(id: string) {
  return apiGet<PublicIncident>(`/status/incidents/${encodeURIComponent(id)}`, { revalidate: PUBLIC_REVALIDATE })
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const res = await load((await params).id)
  return res.ok ? { title: res.data.title } : { title: 'Incident not found' }
}

/** A published incident: state, affected checks, public updates and the public report. 404 unless published. */
export default async function PublicIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await load(id)
  if (!res.ok && res.status === 404) notFound()
  if (!res.ok) {
    return (
      <>
        <div>
          <BackLink href="/">Status</BackLink>
          <PublicHeader title="Incident" />
        </div>
        <ApiErrorCallout what="incident" error={res.error} />
      </>
    )
  }
  const i = res.data
  const open = i.state !== 'resolved'
  const end = i.resolved_at ? Date.parse(i.resolved_at) : Date.now()
  return (
    <>
      <div>
        <BackLink href="/">Status</BackLink>
        <PublicHeader title={i.title} />
      </div>
      <div className="sn-row">
        <StatusIndicator kind={open ? severityKind(i.severity) : 'recovered'} chip label={open ? undefined : 'Resolved'} />
        <Visibility published>{INCIDENT_STATE_LABELS[i.state]}</Visibility>
        <span className="sn-muted">
          <Time iso={i.started_at} /> · {open ? `for ${formatDuration(end - Date.parse(i.started_at))}` : `lasted ${formatDuration(end - Date.parse(i.started_at))}`}
        </span>
      </div>
      <section>
        <h2 className="sn-section__title sn-h">Affected checks</h2>
        {i.tests.map((name) => (
          <div key={name} className="sn-channel">
            <span className="sn-channel__name">{name}</span>
          </div>
        ))}
      </section>
      <div className="sn-two">
        <section>
          <h2 className="sn-section__title sn-h">Updates</h2>
          {i.updates.length > 0 ? <IncidentTimeline updates={i.updates.map((u) => ({ ...u, kind: 'note' as const }))} publicView /> : <p className="sn-emptyline">No updates were published yet.</p>}
        </section>
        <section>
          <h2 className="sn-section__title sn-h">Report</h2>
          {i.report ? <IncidentReport sections={i.report} /> : <p className="sn-emptyline">A report will be published here after the incident is resolved.</p>}
        </section>
      </div>
    </>
  )
}
